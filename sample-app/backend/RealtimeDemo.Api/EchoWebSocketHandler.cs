// =============================================================================
// EchoWebSocketHandler
// -----------------------------------------------------------------------------
// Hand-written, low-level WebSocket endpoint to show students what SignalR
// abstracts away.
//
//   GET /ws/echo  (HTTP upgrade → WebSocket)
//      • Echoes any text frame back to the sender with " (echo)" appended.
//      • Periodically sends an unsolicited "tick" frame so students see
//        server→client push.
//      • All authenticated — JWT validated up-front via the access_token query
//        string (raw WebSocket cannot carry an Authorization header in the
//        browser, exactly like EventSource — students should notice the parity).
// =============================================================================

using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using RealtimeDemo.Api.Telemetry;

namespace RealtimeDemo.Api;

public static class EchoWebSocketHandler
{
    public static void MapEchoWebSocket(this WebApplication app, string path = "/ws/echo")
    {
        app.Map(path, async (HttpContext ctx, TelemetryService tele, ILoggerFactory lf) =>
        {
            var log = lf.CreateLogger("EchoWS");

            if (!ctx.WebSockets.IsWebSocketRequest)
            {
                ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
                await ctx.Response.WriteAsync("WebSocket required");
                return;
            }

            // Authentication is performed by the JWT-bearer middleware which
            // is configured (in Program.cs) to read `access_token` from the
            // query string for /ws/* and /hubs/* paths.
            if (ctx.User?.Identity?.IsAuthenticated != true)
            {
                ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }

            var user = ctx.User.Identity!.Name ?? "anon";

            using var ws = await ctx.WebSockets.AcceptWebSocketAsync();
            tele.Track("WebSocket", "connected", user: user);

            // Background task: periodic "tick" to demonstrate server push.
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ctx.RequestAborted);
            _ = Task.Run(async () =>
            {
                var counter = 0;
                try
                {
                    while (!cts.IsCancellationRequested && ws.State == WebSocketState.Open)
                    {
                        await Task.Delay(2000, cts.Token);
                        if (ws.State != WebSocketState.Open) break;
                        var payload = JsonSerializer.Serialize(new
                        {
                            type = "tick",
                            n = ++counter,
                            at = DateTime.UtcNow
                        });
                        var bytes = Encoding.UTF8.GetBytes(payload);
                        await ws.SendAsync(bytes, WebSocketMessageType.Text, true, cts.Token);
                        tele.Track("WebSocket", "tick_sent", user: user, value: counter);
                    }
                }
                catch (OperationCanceledException) { /* normal */ }
                catch (WebSocketException) { /* client gone */ }
            }, cts.Token);

            // Foreground loop: read & echo client messages.
            var buf = new byte[4 * 1024];
            try
            {
                while (ws.State == WebSocketState.Open)
                {
                    var res = await ws.ReceiveAsync(buf, cts.Token);
                    if (res.MessageType == WebSocketMessageType.Close)
                    {
                        await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None);
                        break;
                    }

                    var text = Encoding.UTF8.GetString(buf, 0, res.Count);
                    tele.Track("WebSocket", "message_in", user: user, detail: text, value: res.Count);

                    var reply = JsonSerializer.Serialize(new
                    {
                        type = "echo",
                        from = user,
                        original = text,
                        echoed = text + " (echo)"
                    });
                    var replyBytes = Encoding.UTF8.GetBytes(reply);
                    await ws.SendAsync(replyBytes, WebSocketMessageType.Text, true, cts.Token);
                    tele.Track("WebSocket", "message_out", user: user, value: replyBytes.Length);
                }
            }
            catch (OperationCanceledException) { /* shutting down */ }
            catch (WebSocketException ex) { log.LogInformation("WS closed: {Msg}", ex.Message); }
            finally
            {
                cts.Cancel();
                tele.Track("WebSocket", "disconnected", user: user);
            }
        });
    }
}
