// Socket tasks capture validated input; a fixed server tick owns simulation.
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace EmojiDelta.Server;

public class GameServer
{
    private readonly HttpListener _http = new();
    private readonly ConcurrentDictionary<string, PlayerSession> _sessions = new();
    private readonly GameWorld _world = new();
    private readonly CancellationTokenSource _cts = new();
    private readonly object _stateLock = new();
    private readonly List<Messages.SoundEvent> _pendingSounds = new();
    private readonly List<PendingEvent> _pendingEvents = new();
    private int _tick;
    private const float TickDuration = 1f / 60f;
    private const int MaxMessageBytes = 4096;
    private record PendingEvent(string TargetId, Messages.S2C_GameEvent Message);

    public async Task Start(string url = "http://localhost:5000/", CancellationToken cancellationToken = default)
    {
        using var registration = cancellationToken.Register(Stop);
        _http.Prefixes.Add(url);
        _http.Start();
        Console.WriteLine($"🦅 Emoji Delta Server listening on {url}");
        try { await Task.WhenAll(GameLoop(), AcceptLoop()); }
        catch (OperationCanceledException) when (_cts.IsCancellationRequested) { }
        finally { Stop(); }
    }

    private async Task AcceptLoop()
    {
        while (!_cts.IsCancellationRequested)
        {
            try
            {
                var context = await _http.GetContextAsync().WaitAsync(_cts.Token);
                if (!context.Request.IsWebSocketRequest)
                {
                    context.Response.StatusCode = 400;
                    context.Response.Close();
                    continue;
                }
                var socket = await context.AcceptWebSocketAsync(null);
                _ = HandleClient(socket.WebSocket);
            }
            catch (Exception ex) when (_cts.IsCancellationRequested && ex is OperationCanceledException or HttpListenerException or ObjectDisposedException) { break; }
            catch (Exception ex) { Console.WriteLine($"Accept error: {ex.Message}"); }
        }
    }

    private async Task HandleClient(WebSocket socket)
    {
        using var clientCancellation = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
        var session = new PlayerSession { Socket = socket };
        Task sender;
        lock (_stateLock)
        {
            // Map must precede snapshots. Joining starts in the lobby, not a raid.
            QueueMessage(session, new Messages.S2C_MapInit(
                GameWorld.WorldWidth, GameWorld.WorldHeight, GameWorld.TileSize, 400, GameWorld.WorldHeight - 400,
                _world.Walls.Select(w => new Messages.WallData((int)w.X, (int)w.Y, (int)w.W, (int)w.H, w.Emoji, w.BlockingLoS)).ToList(),
                new Messages.ExtractionData(_world.Extraction.X, _world.Extraction.Y, _world.Extraction.W, _world.Extraction.H, _world.Extraction.Emoji)));
            _sessions[session.Id] = session;
            sender = SendLoop(session, clientCancellation.Token);
        }
        Console.WriteLine($"[+] Player {session.Id} connected");
        var buffer = new byte[MaxMessageBytes];
        using var message = new MemoryStream();
        try
        {
            while (socket.State == WebSocketState.Open && !clientCancellation.IsCancellationRequested)
            {
                var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), clientCancellation.Token);
                if (result.MessageType == WebSocketMessageType.Close) break;
                if (result.MessageType != WebSocketMessageType.Text || message.Length + result.Count > MaxMessageBytes) { socket.Abort(); break; }
                message.Write(buffer, 0, result.Count);
                if (!result.EndOfMessage) continue;
                ProcessMessage(session, Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length));
                message.SetLength(0);
            }
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException or ObjectDisposedException) { }
        finally
        {
            lock (_stateLock) _sessions.TryRemove(session.Id, out _);
            session.Outgoing.Writer.TryComplete();
            clientCancellation.Cancel();
            socket.Abort();
            try { await sender; } catch (OperationCanceledException) { }
            socket.Dispose();
            Console.WriteLine($"[-] Player {session.Id} disconnected");
        }
    }

    private static bool WithinRateLimit(PlayerSession session)
    {
        var now = Stopwatch.GetTimestamp();
        if (Stopwatch.GetElapsedTime(session.RateWindowStart, now).TotalSeconds >= 1)
        {
            session.RateWindowStart = now;
            session.MessagesInWindow = 0;
        }
        return ++session.MessagesInWindow <= 180;
    }

    private void ProcessMessage(PlayerSession session, string json)
    {
        lock (_stateLock)
        {
            if (!WithinRateLimit(session) || json.Length > MaxMessageBytes) return;
            try
            {
                using var document = JsonDocument.Parse(json);
                var root = document.RootElement;
                if (!root.TryGetProperty("type", out var property) || property.ValueKind != JsonValueKind.String) return;
                switch (property.GetString())
                {
                    case "DEPLOY":
                        if (session.Phase == RaidPhase.InRaid) return;
                        _pendingEvents.RemoveAll(pending => pending.TargetId == session.Id);
                        session.X = 400; session.Y = GameWorld.WorldHeight - 400;
                        session.Hp = session.MaxHp; session.Armor = session.MaxArmor; session.Stamina = session.MaxStamina;
                        session.Gun = new(); session.Inventory.Clear();
                        session.IsExtracting = false; session.ExtractTimer = 0;
                        session.LastReceivedSeq = session.LastProcessedSeq = session.InputSeq = 0;
                        ClearInputs(session); session.Phase = RaidPhase.InRaid;
                        Event(session, "deployed", "成功部署");
                        break;
                    case "INPUT":
                        if (session.Phase == RaidPhase.InRaid && session.Hp > 0) HandleInput(session, root);
                        break;
                    case "RELOAD":
                        if (session.Phase == RaidPhase.InRaid) session.ReloadRequested = true;
                        break;
                    case "INTERACT":
                        if (session.Phase == RaidPhase.InRaid) session.InteractRequested = true;
                        break;
                }
            }
            catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException or OverflowException) { }
        }
    }

    private void HandleInput(PlayerSession session, JsonElement root)
    {
        if (!root.TryGetProperty("seq", out var sequence) || !sequence.TryGetInt32(out var seq) || seq <= session.LastReceivedSeq) return;
        // dt is accepted for protocol compatibility only; it never advances time.
        if (root.TryGetProperty("dt", out var delta) && (!delta.TryGetSingle(out var dt) || !float.IsFinite(dt) || dt <= 0 || dt > 0.25f)) return;
        var angle = 0f;
        if (root.TryGetProperty("fireAngle", out var value) && (!value.TryGetSingle(out angle) || !float.IsFinite(angle))) return;
        var w = GetBool(root, "w"); var a = GetBool(root, "a"); var s = GetBool(root, "s"); var d = GetBool(root, "d");
        var sprint = GetBool(root, "sprint"); var fire = GetBool(root, "fire"); var interact = GetBool(root, "interact");
        session.MoveW = w; session.MoveA = a; session.MoveS = s; session.MoveD = d;
        session.SprintInput = sprint; session.FireInput = fire; session.FireAngle = angle % (MathF.PI * 2);
        session.InteractRequested |= interact;
        session.LastReceivedSeq = session.InputSeq = seq; session.LastInputTick = _tick;
    }

    private void Event(PlayerSession session, string kind, string text) =>
        _pendingEvents.Add(new(session.Id, new(kind, text, PlayerId: session.Id)));

    private static void ClearInputs(PlayerSession session, bool includeActions = true)
    {
        session.MoveW = session.MoveA = session.MoveS = session.MoveD = false;
        session.FireInput = session.SprintInput = false;
        if (includeActions) session.ReloadRequested = session.InteractRequested = false;
    }

    private void EndRaid(PlayerSession session, bool survived)
    {
        if (session.Phase != RaidPhase.InRaid) return;
        session.Phase = survived ? RaidPhase.Extracted : RaidPhase.Dead;
        session.IsExtracting = false; session.ExtractTimer = 0;
        ClearInputs(session);
        Event(session, survived ? "extraction_complete" : "player_killed", survived ? "撤离成功" : "你已被消灭");
    }

    // Called only by the fixed tick, under _stateLock. Socket input cannot call this.
    private void AdvanceTick()
    {
        _tick++;
        var active = _sessions.Values.Where(p => p.Phase == RaidPhase.InRaid).ToList();
        foreach (var session in active)
        {
            if (session.Hp <= 0) { EndRaid(session, false); continue; }
            if (_tick - session.LastInputTick > 15) ClearInputs(session, includeActions: false);
            _world.ProcessPlayerMovement(session, TickDuration, session.MoveW, session.MoveA, session.MoveS, session.MoveD, session.SprintInput);
            session.Gun.Cooldown = MathF.Max(0, session.Gun.Cooldown - TickDuration);
            if (session.ReloadRequested && !session.Gun.IsReloading && session.Gun.CurrentAmmo < session.Gun.MagSize && session.Gun.MaxAmmo > 0)
            {
                session.Gun.IsReloading = true; session.Gun.ReloadTimer = session.Gun.ReloadTime;
            }
            session.ReloadRequested = false;
            if (session.Gun.IsReloading)
            {
                session.Gun.ReloadTimer -= TickDuration;
                if (session.Gun.ReloadTimer <= 0)
                {
                    var amount = Math.Min(session.Gun.MagSize - session.Gun.CurrentAmmo, session.Gun.MaxAmmo);
                    session.Gun.CurrentAmmo += amount; session.Gun.MaxAmmo -= amount;
                    session.Gun.IsReloading = false; session.Gun.ReloadTimer = 0;
                }
            }
            else if (session.FireInput && session.Gun.Cooldown <= 0 && session.Gun.CurrentAmmo > 0)
            {
                _world.ProcessShot(session.X, session.Y, session.FireAngle, session.Spread, session);
                _pendingSounds.Add(new(session.X, session.Y, 600, "gunshot"));
            }
            if (session.InteractRequested) _world.HandleInteract(session);
            session.InteractRequested = false; session.LastProcessedSeq = session.InputSeq;
        }
        var alive = active.Where(p => p.Phase == RaidPhase.InRaid && p.Hp > 0).ToList();
        var healthBefore = alive.ToDictionary(p => p.Id, p => (p.Hp, p.Armor));
        _pendingSounds.AddRange(_world.UpdateBots(TickDuration, alive));
        foreach (var session in alive)
        {
            if (session.Hp <= 0) { EndRaid(session, false); continue; }
            var wasHit = session.Hp < healthBefore[session.Id].Hp || session.Armor < healthBefore[session.Id].Armor;
            if (_world.CheckExtraction(session))
            {
                if (!session.IsExtracting)
                {
                    session.IsExtracting = true; session.ExtractTimer = PlayerSession.ExtractDuration;
                    Event(session, "extraction_start", "进入撤离区");
                }
                if (wasHit) session.ExtractTimer = PlayerSession.ExtractDuration;
                else session.ExtractTimer -= TickDuration;
                if (session.ExtractTimer <= 0) EndRaid(session, true);
            }
            else if (session.IsExtracting)
            {
                session.IsExtracting = false; session.ExtractTimer = 0;
                Event(session, "extraction_cancel", "撤离中断");
            }
        }
    }

    private async Task GameLoop()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(TickDuration));
        while (await timer.WaitForNextTickAsync(_cts.Token))
        {
            lock (_stateLock)
            {
                AdvanceTick();
                if (_tick % 3 == 0) // snapshots at 20 Hz, simulation at 60 Hz
                {
                    foreach (var session in _sessions.Values)
                    {
                        var entities = _sessions.Values.Where(other => other.Id != session.Id && other.Phase == RaidPhase.InRaid)
                            .Select(other => new Messages.EntityState(other.Id, "player", other.Emoji, other.X, other.Y, other.Hp, other.MaxHp, false)).ToList();
                        entities.AddRange(_world.Bots.Where(b => b.Hp > 0).Select(b => new Messages.EntityState(b.Id, "bot", b.Emoji, b.X, b.Y, b.Hp, b.MaxHp, false)));
                        entities.AddRange(_world.Loots.Select(l => new Messages.EntityState(l.Id, "loot", l.Emoji, l.X, l.Y, 1, 1, false)));
                        QueueMessage(session, new Messages.S2C_Snapshot(_tick, DateTime.UtcNow.Ticks, session.LastProcessedSeq,
                            session.X, session.Y, entities, new(_pendingSounds), session.Hp, session.Armor, session.Gun.CurrentAmmo, session.Gun.MaxAmmo, session.Phase.ToString()));
                    }
                    _pendingSounds.Clear();
                }
                FlushEvents();
            }
        }
    }

    private void FlushEvents()
    {
        foreach (var pending in _pendingEvents)
            if (_sessions.TryGetValue(pending.TargetId, out var recipient)) QueueMessage(recipient, pending.Message);
        _pendingEvents.Clear();
    }

    private static void QueueMessage(PlayerSession session, object message)
    {
        if (!session.Outgoing.Writer.TryWrite(message)) session.Socket.Abort();
    }

    private static async Task SendLoop(PlayerSession session, CancellationToken cancellationToken)
    {
        try
        {
            await foreach (var message in session.Outgoing.Reader.ReadAllAsync(cancellationToken))
            {
                var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(message, Messages.JsonOpts));
                await session.Socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, cancellationToken);
            }
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException or ObjectDisposedException) { session.Socket.Abort(); }
    }

    private static bool GetBool(JsonElement root, string key) => root.TryGetProperty(key, out var property) && property.GetBoolean();

    public void Stop()
    {
        _cts.Cancel();
        if (_http.IsListening) _http.Stop();
        foreach (var session in _sessions.Values) session.Socket.Abort();
    }
}
