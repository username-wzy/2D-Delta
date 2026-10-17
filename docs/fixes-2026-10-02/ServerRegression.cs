// Real handler, fixed simulation tick and event queues, with deterministic
// terrain and an in-memory WebSocket. No listener or external service starts.
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.WebSockets;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using EmojiDelta.Server;

var results = new List<object>();
int passed = 0, total = 0;
async Task Check(string id, Func<Task> action)
{
    total++;
    try { await action(); passed++; results.Add(new { id, passed = true }); Console.WriteLine($"PASS {id}"); }
    catch (Exception ex) { results.Add(new { id, passed = false, error = ex.ToString() }); Console.WriteLine($"FAIL {id}: {ex.Message}"); }
}
void Require(bool yes, string why) { if (!yes) throw new Exception(why); }

await Check("S01: input stages movement; invalid dt and malformed data have no effect", () =>
{
    var f = new Fixture(); var p = f.Player();
    f.Message(p, "{\"type\":\"INPUT\",\"seq\":1,\"dt\":5,\"d\":true}");
    Require(p.X == 400 && p.LastReceivedSeq == 0, "oversized dt accepted");
    f.Message(p, "{\"type\":\"INPUT\",\"seq\":1,\"dt\":-1,\"d\":true}");
    f.Message(p, "{\"type\":\"INPUT\",\"seq\":1,\"dt\":0.016,\"d\":\"true\"}");
    f.Message(p, "{\"type\":\"INPUT\",\"seq\":1,\"fireAngle\":1e100,\"d\":true}");
    Require(p.X == 400 && p.LastReceivedSeq == 0, "malformed input changed state");
    f.Input(p, 1, right: true); Require(p.X == 400, "socket input advanced simulation");
    f.Tick(); Require(Math.Abs(p.X - 405) < 0.001 && p.LastProcessedSeq == 1, "tick did not advance exactly 5px");
    return Task.CompletedTask;
});
await Check("S01: repeated/stale seq and input floods cannot accelerate movement", () =>
{
    var f = new Fixture(); var p = f.Player();
    for (int i = 0; i < 100; i++) f.Input(p, 1, right: true);
    Require(p.X == 400 && p.LastReceivedSeq == 1, "repeat seq moved player");
    f.Tick(); Require(p.X == 405, "repeat messages accelerated movement");
    for (int i = 2; i < 500; i++) f.Input(p, i, right: true);
    Require(p.LastReceivedSeq < 500 && p.X == 405, "rate limit did not reject flood");
    f.Tick(); Require(p.X == 410, "unique seq flood accelerated movement");
    p.MessagesInWindow = 0; f.Input(p, 1, right: false); Require(p.MoveD, "stale seq replaced newer input");
    return Task.CompletedTask;
});
await Check("S01: heartbeat timeout releases movement and firing", () =>
{
    var f = new Fixture(); var p = f.Player(); f.Input(p, 1, right:true, fire:true);
    f.Ticks(15); var x = p.X; var ammo = p.Gun.CurrentAmmo;
    f.Ticks(10); Require(p.X == x && p.Gun.CurrentAmmo == ammo && !p.MoveD && !p.FireInput, "stale input stayed active");
    p.Gun.CurrentAmmo = 0; f.Message(p,"{\"type\":\"RELOAD\"}"); f.Tick();
    Require(p.Gun.IsReloading, "heartbeat timeout discarded a fresh reload command");
    return Task.CompletedTask;
});
await Check("S01: cooldown and reload advance only with server ticks", () =>
{
    var f = new Fixture(); var p = f.Player(); p.Gun.CurrentAmmo = 0;
    f.Message(p, "{\"type\":\"RELOAD\"}"); f.Tick();
    for(int i=0; i<100; i++) f.Input(p, i+1);
    Require(p.Gun.IsReloading && p.Gun.CurrentAmmo == 0 && p.Gun.ReloadTimer > 1.7f, "messages advanced reload");
    f.Ticks(100); Require(p.Gun.CurrentAmmo == 0, "reload completed early");
    f.Ticks(10); Require(p.Gun.CurrentAmmo == 30 && p.Gun.MaxAmmo == 90 && !p.Gun.IsReloading, "reload failed or duplicated ammo");
    p.Gun.Cooldown = 0.5f; p.MessagesInWindow = 0;
    for(int i=101; i<170; i++) f.Input(p,i,fire:true);
    Require(p.Gun.Cooldown == 0.5f && p.Gun.CurrentAmmo == 30, "messages advanced fire cooldown");
    f.Tick(); Require(p.Gun.Cooldown < 0.5f && p.Gun.CurrentAmmo == 30, "cooldown timing wrong");
    return Task.CompletedTask;
});
await Check("S02: extraction takes 10 simulated seconds and settles only once", () =>
{
    var f = new Fixture(); var p = f.Player(); p.X = 2820; p.Y = 320;
    f.Input(p,1); Require(!p.IsExtracting, "network message started extraction immediately");
    f.Ticks(599); Require(p.Phase == RaidPhase.InRaid && p.IsExtracting, "extraction completed early");
    f.Ticks(4); Require(p.Phase == RaidPhase.Extracted && !p.IsExtracting, "extraction did not terminate");
    f.Ticks(120); f.Input(p,2,right:true); f.Ticks(10);
    Require(p.X == 2820 && f.Events(p,"extraction_complete") == 1, "extracted player moved or received duplicate result");
    return Task.CompletedTask;
});
await Check("S02: fatal hit on final extraction tick produces death only", () =>
{
    var f = new Fixture(); var p = f.Player(); p.X=2820; p.Y=320; p.Hp=1; p.Armor=0; p.IsExtracting=true; p.ExtractTimer=0.001f;
    f.Bots.Add(new GameWorld.BotState(2830,320,"melee") {State="aggro",TargetX=2830,TargetY=320,FireCooldown=0});
    f.Tick(); Require(p.Phase == RaidPhase.Dead && f.Events(p,"player_killed")==1 && f.Events(p,"extraction_complete")==0, "death and extraction both emitted");
    f.Ticks(100); Require(f.Events(p,"player_killed")==1, "death repeated every tick");
    return Task.CompletedTask;
});
await Check("S02: leaving extraction cancels; damage resets timer", () =>
{
    var f=new Fixture(); var p=f.Player(); p.X=2820; p.Y=320; f.Tick(); f.Ticks(60);
    Require(p.ExtractTimer < 9.1f,"extraction not ticking");
    f.Bots.Add(new GameWorld.BotState(2830,320,"melee") {State="aggro",TargetX=2830,TargetY=320,FireCooldown=0});
    f.Tick(); Require(Math.Abs(p.ExtractTimer-10)<0.001f,"damage failed to reset extraction");
    p.X=400; p.Y=2000; f.Tick(); Require(!p.IsExtracting && f.Events(p,"extraction_cancel")==1,"leaving did not cancel");
    return Task.CompletedTask;
});
await Check("S02: terminal events target their player and queues do not broadcast them", () =>
{
    var f=new Fixture(); var p=f.Player(); var other=f.Player(); p.Hp=0; f.Tick(); f.Flush();
    Require(p.Outgoing.Reader.TryRead(out var message) && message is Messages.S2C_GameEvent e && e.PlayerId==p.Id && e.Event=="player_killed","owner did not receive result");
    Require(!other.Outgoing.Reader.TryRead(out _),"another player received private result");
    f.Ticks(10); f.Flush(); Require(!p.Outgoing.Reader.TryRead(out _),"death repeated after flush");
    return Task.CompletedTask;
});
await Check("raid phases: lobby input is ignored; duplicate deploy cannot heal; redeploy resets", () =>
{
    var f=new Fixture(); var p=f.Player(); p.Phase=RaidPhase.Lobby;
    f.Input(p,1,right:true); f.Tick(); Require(p.X==400 && p.LastReceivedSeq==0,"lobby input applied");
    f.Message(p,"{\"type\":\"DEPLOY\"}"); p.Hp=17; p.Inventory.Add(new("x","gem","",""));
    f.Message(p,"{\"type\":\"DEPLOY\"}"); Require(p.Hp==17 && p.Inventory.Count==1,"duplicate deploy reset active raid");
    p.Hp=0; f.Tick(); f.Message(p,"{\"type\":\"DEPLOY\"}");
    Require(p.Phase==RaidPhase.InRaid && p.Hp==p.MaxHp && p.Inventory.Count==0 && p.LastReceivedSeq==0,"redeploy not reset");
    Require(f.Events(p,"player_killed")==0,"old pending result survived redeploy");
    return Task.CompletedTask;
});
await Check("protocol: serialized outbound messages carry type and player id", () =>
{
    var json=JsonSerializer.Serialize(new Messages.S2C_GameEvent("player_killed","dead",PlayerId:"p"),Messages.JsonOpts);
    using var doc=JsonDocument.Parse(json); Require(doc.RootElement.GetProperty("type").GetString()=="GAME_EVENT" && doc.RootElement.GetProperty("playerId").GetString()=="p","event discriminator or owner missing");
    return Task.CompletedTask;
});
await Check("WebSocket: fragments reassemble and a single sender preserves output order", async () =>
{
    var f=new Fixture(); var socket=new MemorySocket(); var task=f.Connect(socket);
    await WaitUntil(()=>f.Sessions.Count==1); var p=f.Sessions.Values.Single();
    socket.Text("{\"type\":\"DEP",false); socket.Text("LOY\"}",true);
    await WaitUntil(()=>p.Phase==RaidPhase.InRaid);
    socket.Text("{\"type\":\"INPUT\",\"seq\":",false); socket.Text("1,\"dt\":0.016,\"d\":true}",true);
    await WaitUntil(()=>p.LastReceivedSeq==1); f.Tick(); f.Flush();
    await WaitUntil(()=>socket.Sent.Count>=2); var messages=socket.Sent.ToArray();
    Require(JsonDocument.Parse(messages[0]).RootElement.GetProperty("type").GetString()=="MAP_INIT","map did not precede events");
    Require(socket.MaxConcurrentSends==1,"concurrent WebSocket sends");
    socket.CloseInput(); await task.WaitAsync(TimeSpan.FromSeconds(2)); Require(f.Sessions.IsEmpty,"disconnect retained session");
});
await Check("WebSocket: oversized fragmented messages abort without deployment", async () =>
{
    var f=new Fixture(); var socket=new MemorySocket(); var task=f.Connect(socket);
    await WaitUntil(()=>f.Sessions.Count==1); var p=f.Sessions.Values.Single();
    socket.Text(new string(' ',3000),false); socket.Text(new string(' ',2000),true);
    await task.WaitAsync(TimeSpan.FromSeconds(2)); Require(socket.WasAborted && p.Phase==RaidPhase.Lobby && f.Sessions.IsEmpty,"oversized message accepted");
});

var output=JsonSerializer.Serialize(new {date="2026-10-02",methodology="Real server handler, fixed ticks, targeted channels and in-memory WebSocket; deterministic terrain. No HTTP listener or browser multiplayer integration.",passed,total,results},new JsonSerializerOptions {WriteIndented=true});
File.WriteAllText(Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"..","..","..","server-regression-results.json")),output);
Console.WriteLine($"{passed}/{total} checks passed");
Environment.ExitCode=passed==total?0:1;

static async Task WaitUntil(Func<bool> condition)
{
    var watch=Stopwatch.StartNew();
    while(!condition()) {if(watch.Elapsed.TotalSeconds>2) throw new TimeoutException(); await Task.Delay(5);}
}

sealed class Fixture
{
    private const BindingFlags Flags=BindingFlags.NonPublic|BindingFlags.Instance;
    public GameServer Server {get;}=new();
    public ConcurrentDictionary<string,PlayerSession> Sessions {get;}
    public List<GameWorld.BotState> Bots {get;}
    private readonly System.Collections.IEnumerable events;
    public Fixture()
    {
        var world=(GameWorld)typeof(GameServer).GetField("_world",Flags)!.GetValue(Server)!;
        ((List<GameWorld.WallData>)typeof(GameWorld).GetField("_walls",Flags)!.GetValue(world)!).Clear();
        var hash=typeof(GameWorld).GetField("_wallHash",Flags)!.GetValue(world)!; hash.GetType().GetMethod("Clear")!.Invoke(hash,null);
        Bots=(List<GameWorld.BotState>)typeof(GameWorld).GetField("_bots",Flags)!.GetValue(world)!; Bots.Clear();
        ((List<GameWorld.LootState>)typeof(GameWorld).GetField("_loots",Flags)!.GetValue(world)!).Clear();
        Sessions=(ConcurrentDictionary<string,PlayerSession>)typeof(GameServer).GetField("_sessions",Flags)!.GetValue(Server)!;
        events=(System.Collections.IEnumerable)typeof(GameServer).GetField("_pendingEvents",Flags)!.GetValue(Server)!;
    }
    public PlayerSession Player() {var p=new PlayerSession {X=400,Y=2000,Phase=RaidPhase.InRaid,Socket=new MemorySocket()}; Sessions[p.Id]=p; return p;}
    public void Message(PlayerSession p,string json)=>typeof(GameServer).GetMethod("ProcessMessage",Flags)!.Invoke(Server,[p,json]);
    public void Input(PlayerSession p,int seq,bool right=false,bool fire=false)=>Message(p,JsonSerializer.Serialize(new {type="INPUT",seq,dt=1f/60f,d=right,fire}));
    public void Tick()=>typeof(GameServer).GetMethod("AdvanceTick",Flags)!.Invoke(Server,null);
    public void Ticks(int count) {for(int i=0;i<count;i++) Tick();}
    public void Flush()=>typeof(GameServer).GetMethod("FlushEvents",Flags)!.Invoke(Server,null);
    public Task Connect(WebSocket socket)=>(Task)typeof(GameServer).GetMethod("HandleClient",Flags)!.Invoke(Server,[socket])!;
    public int Events(PlayerSession p,string kind)
    {
        int count=0;
        foreach(var item in events)
        {
            var type=item!.GetType(); var target=(string)type.GetProperty("TargetId")!.GetValue(item)!;
            var message=(Messages.S2C_GameEvent)type.GetProperty("Message")!.GetValue(item)!;
            if(target==p.Id && message.Event==kind) count++;
        }
        return count;
    }
}

sealed class MemorySocket:WebSocket
{
    private WebSocketState state=WebSocketState.Open;
    private readonly Channel<(byte[] Data,bool End,WebSocketMessageType Type)> incoming=Channel.CreateUnbounded<(byte[],bool,WebSocketMessageType)>();
    private int sending;
    public ConcurrentQueue<string> Sent {get;}=new();
    public int MaxConcurrentSends {get;private set;}
    public bool WasAborted {get;private set;}
    public override WebSocketState State=>state;
    public override WebSocketCloseStatus? CloseStatus=>null;
    public override string? CloseStatusDescription=>null;
    public override string? SubProtocol=>null;
    public void Text(string data,bool end)=>incoming.Writer.TryWrite((Encoding.UTF8.GetBytes(data),end,WebSocketMessageType.Text));
    public void CloseInput()=>incoming.Writer.TryWrite(([],true,WebSocketMessageType.Close));
    public override void Abort() {WasAborted=true; state=WebSocketState.Aborted;}
    public override void Dispose() {}
    public override Task CloseAsync(WebSocketCloseStatus status,string? description,CancellationToken token) {state=WebSocketState.Closed; return Task.CompletedTask;}
    public override Task CloseOutputAsync(WebSocketCloseStatus status,string? description,CancellationToken token)=>CloseAsync(status,description,token);
    public override async Task<WebSocketReceiveResult> ReceiveAsync(ArraySegment<byte> buffer,CancellationToken token)
    {
        var message=await incoming.Reader.ReadAsync(token); message.Data.CopyTo(buffer.Array!,buffer.Offset);
        return new(message.Data.Length,message.Type,message.End);
    }
    public override async Task SendAsync(ArraySegment<byte> buffer,WebSocketMessageType type,bool end,CancellationToken token)
    {
        MaxConcurrentSends=Math.Max(MaxConcurrentSends,Interlocked.Increment(ref sending));
        try {await Task.Delay(5,token); Sent.Enqueue(Encoding.UTF8.GetString(buffer));}
        finally {Interlocked.Decrement(ref sending);}
    }
}
