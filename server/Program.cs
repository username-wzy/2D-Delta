// Program.cs - Entry point for Emoji Delta authoritative server
using EmojiDelta.Server;

Console.OutputEncoding = System.Text.Encoding.UTF8;
Console.WriteLine("🦅 Emoji Delta - Authoritative Game Server v0.2");
Console.WriteLine("==============================================");

var server = new GameServer();
var cts = new CancellationTokenSource();

Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cts.Cancel();
    Console.WriteLine("\nShutting down...");
};

try
{
    await server.Start("http://localhost:5000/", cts.Token);
}
catch (OperationCanceledException)
{
    server.Stop();
    Console.WriteLine("Server stopped.");
}
