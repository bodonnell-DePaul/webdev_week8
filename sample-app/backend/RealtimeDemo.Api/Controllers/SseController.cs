// =============================================================================
// SseController
// -----------------------------------------------------------------------------
// Demonstrates Server-Sent Events.
//
//   GET /api/sse/stream
//        Long-lived HTTP response with `Content-Type: text/event-stream`.
//        Sends a `data: {...}` line for every new PollItem produced via the
//        Polling /produce endpoint, plus a `: keep-alive` comment every 15s.
//
// IMPORTANT NOTES FOR STUDENTS (see Lecture §6.4):
//
//   • The native browser `EventSource` API CANNOT set custom headers, including
//     `Authorization: Bearer ...`. To demonstrate this fact honestly we accept
//     auth in two ways:
//        (a) cookie-based auth (not enabled in this minimal sample), OR
//        (b) `?access_token=<jwt>` query string — convenient for demos but
//            should NEVER appear in production logs. The middleware in
//            Program.cs strips it from logging and warns if used.
//   • The frontend demo uses option (b) and logs a banner explaining the
//     trade-off.
// =============================================================================

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RealtimeDemo.Api.Data;
using RealtimeDemo.Api.Telemetry;

namespace RealtimeDemo.Api.Controllers;

[ApiController]
[Route("api/sse")]
[Authorize]   // Token must reach us via the access_token query string for SSE.
public class SseController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly TelemetryService _tele;
    private readonly ILogger<SseController> _log;

    public SseController(AppDbContext db, TelemetryService tele, ILogger<SseController> log)
    {
        _db = db; _tele = tele; _log = log;
    }

    [HttpGet("stream")]
    public async Task Stream(
        [FromQuery] int afterId = 0,
        CancellationToken ct = default)
    {
        var user = User?.Identity?.Name;

        // ---- Required SSE response headers --------------------------------
        Response.Headers.ContentType  = "text/event-stream";
        Response.Headers.CacheControl = "no-cache, no-transform";
        // Standard hint to disable buffering by some reverse proxies (e.g. nginx).
        Response.Headers["X-Accel-Buffering"] = "no";
        Response.StatusCode = 200;

        _tele.Track("SSE", "stream_open", user: user, detail: $"afterId={afterId}");

        var lastId = afterId;
        var lastKeepAlive = DateTime.UtcNow;

        // Send an opening event so the client UI can confirm the channel works
        // even before any item is produced.
        await WriteEvent("welcome", new { message = "SSE stream open", user, lastId }, ct);

        try
        {
            while (!ct.IsCancellationRequested)
            {
                // Poll the DB for new items. In a real app you would use a
                // signal (channel, Redis pub/sub, etc.) rather than DB polling
                // — we keep it explicit so the lecture can call this out.
                var items = await _db.PollItems
                    .Where(p => p.Id > lastId)
                    .OrderBy(p => p.Id)
                    .Take(20)
                    .ToListAsync(ct);

                foreach (var item in items)
                {
                    // Use the standard `id:` field so a reconnecting client
                    // can resume from `Last-Event-ID`.
                    await Response.WriteAsync($"id: {item.Id}\n", ct);
                    await Response.WriteAsync("event: item\n", ct);
                    await Response.WriteAsync(
                        "data: " +
                        JsonSerializer.Serialize(new { item.Id, item.Message, item.CreatedAt }) +
                        "\n\n", ct);
                    await Response.Body.FlushAsync(ct);

                    lastId = item.Id;
                    _tele.Track("SSE", "event_sent", user: user, value: item.Id);
                }

                // Send a keep-alive comment every 15s so intermediaries don't
                // idle-close us.
                if ((DateTime.UtcNow - lastKeepAlive).TotalSeconds >= 15)
                {
                    await Response.WriteAsync(": keep-alive\n\n", ct);
                    await Response.Body.FlushAsync(ct);
                    lastKeepAlive = DateTime.UtcNow;
                }

                try { await Task.Delay(500, ct); } catch { }
            }
        }
        catch (OperationCanceledException) { /* client disconnected — fine */ }
        finally
        {
            _tele.Track("SSE", "stream_close", user: user, detail: $"lastId={lastId}");
        }
    }

    private async Task WriteEvent(string eventName, object payload, CancellationToken ct)
    {
        await Response.WriteAsync($"event: {eventName}\n", ct);
        await Response.WriteAsync("data: " + JsonSerializer.Serialize(payload) + "\n\n", ct);
        await Response.Body.FlushAsync(ct);
    }
}
