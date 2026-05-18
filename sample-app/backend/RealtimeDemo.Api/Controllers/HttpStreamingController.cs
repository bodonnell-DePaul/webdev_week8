// =============================================================================
// HttpStreamingController
// -----------------------------------------------------------------------------
// Demonstrates HTTP streaming (newline-delimited JSON chunks) — the same
// technique that powers ChatGPT-style "typing" UIs.
//
//   POST /api/streaming/echo
//        Body: { "text": "..." }
//        Streams the text back token-by-token, one NDJSON line per chunk, with
//        an artificial 50ms delay so students can see the chunks land.
//
// Important differences from SSE that students should observe:
//   • The client uses `fetch().body.getReader()` (not EventSource), so the
//     POST body and the Authorization: Bearer header BOTH work normally.
//   • There is no auto-reconnect; the demo code shows you implementing it
//     yourself.
// =============================================================================

using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RealtimeDemo.Api.Telemetry;

namespace RealtimeDemo.Api.Controllers;

[ApiController]
[Route("api/streaming")]
[Authorize]
public class HttpStreamingController : ControllerBase
{
    private readonly TelemetryService _tele;
    public HttpStreamingController(TelemetryService tele) { _tele = tele; }

    public record EchoRequest(string Text);

    [HttpPost("echo")]
    public async Task Echo([FromBody] EchoRequest req, CancellationToken ct)
    {
        var user = User?.Identity?.Name;
        Response.Headers.ContentType  = "application/x-ndjson";
        Response.Headers.CacheControl = "no-cache, no-transform";
        Response.Headers["X-Accel-Buffering"] = "no";
        Response.StatusCode = 200;

        _tele.Track("HttpStreaming", "stream_open", user: user, detail: req.Text);

        var tokens = (req.Text ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var idx = 0;
        foreach (var tok in tokens)
        {
            if (ct.IsCancellationRequested) break;

            var line = JsonSerializer.Serialize(new { i = idx++, token = tok }) + "\n";
            await Response.WriteAsync(line, Encoding.UTF8, ct);
            await Response.Body.FlushAsync(ct);

            _tele.Track("HttpStreaming", "chunk_sent", user: user, detail: tok);

            try { await Task.Delay(50, ct); } catch { }
        }

        // Final "done" marker.
        await Response.WriteAsync(JsonSerializer.Serialize(new { done = true }) + "\n", Encoding.UTF8, ct);
        await Response.Body.FlushAsync(ct);

        _tele.Track("HttpStreaming", "stream_close", user: user, value: tokens.Length);
    }
}
