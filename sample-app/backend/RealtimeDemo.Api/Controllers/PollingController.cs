// =============================================================================
// PollingController
// -----------------------------------------------------------------------------
// Demonstrates BOTH polling approaches against the same shared PollItem table.
//
//   GET  /api/polling/items?afterId=N
//        SHORT polling — returns immediately with whatever items have id > N.
//        Caller is expected to call again on a timer.
//
//   GET  /api/polling/long-poll?afterId=N&timeoutSec=25
//        LONG polling — if items already exist, returns immediately. Otherwise
//        waits up to timeoutSec for new items, then returns either the new
//        items or an empty list.
//
//   POST /api/polling/produce
//        Test helper — inserts a new item (this is the "server-side event"
//        that the polling demos pick up). Returns the created item.
//
// Every request fires a TelemetryService.Track(...) tagged "Polling".
// =============================================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RealtimeDemo.Api.Data;
using RealtimeDemo.Api.Models;
using RealtimeDemo.Api.Telemetry;

namespace RealtimeDemo.Api.Controllers;

[ApiController]
[Route("api/polling")]
[Authorize]
public class PollingController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly TelemetryService _tele;
    private readonly ILogger<PollingController> _log;

    public PollingController(AppDbContext db, TelemetryService tele, ILogger<PollingController> log)
    {
        _db = db; _tele = tele; _log = log;
    }

    // --------------------------------------------------------------------- //
    // SHORT polling
    // --------------------------------------------------------------------- //
    [HttpGet("items")]
    public async Task<ActionResult<IEnumerable<PollItem>>> Short(
        [FromQuery] int afterId = 0,
        CancellationToken ct = default)
    {
        var user = User?.Identity?.Name;
        var items = await _db.PollItems
            .Where(p => p.Id > afterId)
            .OrderBy(p => p.Id)
            .Take(50)
            .ToListAsync(ct);

        _tele.Track("Polling", "short_poll", user: user, detail: $"afterId={afterId};returned={items.Count}");
        return Ok(items);
    }

    // --------------------------------------------------------------------- //
    // LONG polling
    //
    // Naïve in-process implementation: we sleep-and-check rather than wire up a
    // proper signal. This keeps the demo small and easy to read; the lecture
    // discussion is about the *concept*, not high-scale correctness.
    // --------------------------------------------------------------------- //
    [HttpGet("long-poll")]
    public async Task<ActionResult<IEnumerable<PollItem>>> LongPoll(
        [FromQuery] int afterId = 0,
        [FromQuery] int timeoutSec = 25,
        CancellationToken ct = default)
    {
        var user = User?.Identity?.Name;
        var deadline = DateTime.UtcNow.AddSeconds(Math.Clamp(timeoutSec, 1, 60));

        _tele.Track("Polling", "long_poll_open", user: user, detail: $"afterId={afterId};timeout={timeoutSec}");

        while (!ct.IsCancellationRequested && DateTime.UtcNow < deadline)
        {
            var items = await _db.PollItems
                .Where(p => p.Id > afterId)
                .OrderBy(p => p.Id)
                .Take(50)
                .ToListAsync(ct);

            if (items.Count > 0)
            {
                _tele.Track("Polling", "long_poll_returned", user: user, value: items.Count);
                return Ok(items);
            }

            try { await Task.Delay(500, ct); } catch { /* cancelled */ }
        }

        _tele.Track("Polling", "long_poll_timeout", user: user);
        return Ok(Array.Empty<PollItem>());
    }

    // --------------------------------------------------------------------- //
    // Produce a new item (used by all streaming demos as a shared trigger).
    // --------------------------------------------------------------------- //
    public record ProduceRequest(string Message);

    [HttpPost("produce")]
    public async Task<ActionResult<PollItem>> Produce([FromBody] ProduceRequest req)
    {
        var user = User?.Identity?.Name;
        var item = new PollItem { Message = req.Message ?? "(empty)" };
        _db.PollItems.Add(item);
        await _db.SaveChangesAsync();

        _tele.Track("Polling", "item_produced", user: user, detail: req.Message);
        return Ok(item);
    }
}
