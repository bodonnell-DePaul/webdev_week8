// =============================================================================
// TelemetryController
// -----------------------------------------------------------------------------
// Read-only inspector for the local telemetry mirror (TelemetryEvents table).
// Lets students "see what each demo logged" without an App Insights account.
//
//   GET /api/telemetry/recent?technology=SSE&take=50
//
// Telemetry is also published to Application Insights via TelemetryService —
// see Program.cs and Telemetry/TelemetryService.cs.
// =============================================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RealtimeDemo.Api.Data;

namespace RealtimeDemo.Api.Controllers;

[ApiController]
[Route("api/telemetry")]
[Authorize]
public class TelemetryController : ControllerBase
{
    private readonly AppDbContext _db;
    public TelemetryController(AppDbContext db) { _db = db; }

    [HttpGet("recent")]
    public async Task<IActionResult> Recent(
        [FromQuery] string? technology = null,
        [FromQuery] int take = 100)
    {
        take = Math.Clamp(take, 1, 1000);
        IQueryable<Models.TelemetryEvent> q = _db.TelemetryEvents;
        if (!string.IsNullOrEmpty(technology))
            q = q.Where(t => t.Technology == technology);

        var rows = await q.OrderByDescending(t => t.Id).Take(take).ToListAsync();
        return Ok(rows);
    }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary()
    {
        var rows = await _db.TelemetryEvents
            .GroupBy(t => t.Technology)
            .Select(g => new
            {
                technology = g.Key,
                events = g.Count(),
                lastAt = g.Max(t => t.At),
            })
            .ToListAsync();
        return Ok(rows);
    }
}
