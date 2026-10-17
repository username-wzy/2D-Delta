// Isolated audit: exercise the existing message handler without starting a server.
// Reflection supplies deterministic empty terrain and observes pending events.
using System.Reflection;
using System.Text.Json;
using EmojiDelta.Server;

var server = new GameServer();
var flags = BindingFlags.NonPublic | BindingFlags.Instance;
var handler = typeof(GameServer).GetMethod("ProcessMessage", flags)!;
var world = (GameWorld)typeof(GameServer).GetField("_world", flags)!.GetValue(server)!;
((List<GameWorld.WallData>)typeof(GameWorld).GetField("_walls", flags)!.GetValue(world)!).Clear();
typeof(GameWorld).GetField("_wallHash", flags)!.GetValue(world)!.GetType().GetMethod("Clear")!
    .Invoke(typeof(GameWorld).GetField("_wallHash", flags)!.GetValue(world), null);
var events = (List<Messages.S2C_GameEvent>)typeof(GameServer).GetField("_pendingEvents", flags)!.GetValue(server)!;
var results = new List<object>();
void Input(PlayerSession player, float dt, bool right = false, int seq = 1)
{
    var message = JsonSerializer.Serialize(new {type="INPUT",seq,dt,d=right});
    handler.Invoke(server, new object[] {player, message});
}

var player = new PlayerSession {X=400,Y=2000};
var watch = System.Diagnostics.Stopwatch.StartNew();
Input(player, 5, true);
watch.Stop();
results.Add(new {id="client-dt-trusted", observed=new {x=player.X, distance=player.X-400, elapsedMs=watch.Elapsed.TotalMilliseconds, suspiciousActivity=player.SuspiciousActivity}});

player = new PlayerSession {X=400,Y=2000};
watch.Restart();
for(var i=0;i<100;i++) Input(player,1f/60f,true,1);
watch.Stop();
results.Add(new {id="input-rate-and-sequence-not-checked",observed=new {sameSeqMessages=100, distance=player.X-400, elapsedMs=watch.Elapsed.TotalMilliseconds,lastProcessedSeq=player.LastProcessedSeq}});

player = new PlayerSession {X=400,Y=2000};
player.Gun.CurrentAmmo=0;
player.Gun.IsReloading=true;
player.Gun.ReloadTimer=1.8f;
Input(player,10);
results.Add(new {id="client-dt-instant-reload",observed=new {ammo=player.Gun.CurrentAmmo,isReloading=player.Gun.IsReloading}});

player = new PlayerSession {X=2820,Y=320};
Input(player,10);
Input(player,0.01f);
results.Add(new {id="extraction-instant-and-repeated",observed=new {events=events.Select(x=>x.Event).ToArray(),timer=player.ExtractTimer,isExtracting=player.IsExtracting}});

var output=JsonSerializer.Serialize(new {date="2026-10-01",methodology="Real GameServer.ProcessMessage invoked in process; sockets and tick loop are not started; terrain cleared for deterministic movement.",results},new JsonSerializerOptions {WriteIndented=true});
var destination=Path.Combine(AppContext.BaseDirectory,"..","..","..","server-results.json");
File.WriteAllText(Path.GetFullPath(destination),output);
Console.WriteLine(output);
