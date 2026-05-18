// =============================================================================
// TelemetryService
// -----------------------------------------------------------------------------
// Single place every demo calls to record "this technology did this thing".
//
// Behaviour:
//   - Publishes a TrackEvent (or TrackMetric if a Value is provided) to
//     Application Insights via the injected TelemetryClient. Each event is
//     tagged with `technology=<SSE|WebSocket|SignalR|WebRTC|...>` so dashboards
//     can group by transport.
//   - Also persists a TelemetryEvent row to SQLite, so students who do NOT have
//     an App Insights connection string can still inspect telemetry locally
//     via GET /api/telemetry/recent.
//
// This single-call pattern makes it obvious in the code which technology is
// responsible for which observed behaviour.
// =============================================================================

using Microsoft.ApplicationInsights;
using Microsoft.ApplicationInsights.DataContracts;
using RealtimeDemo.Api.Data;
using RealtimeDemo.Api.Models;

namespace RealtimeDemo.Api.Telemetry;

public class TelemetryService
{
    private readonly TelemetryClient _ai;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<TelemetryService> _log;

    public TelemetryService(
        TelemetryClient ai,
        IServiceScopeFactory scopeFactory,
        ILogger<TelemetryService> log)
    {
        _ai = ai;
        _scopeFactory = scopeFactory;
        _log = log;
    }

    /// <summary>
    /// Record one telemetry event for the given technology.
    /// </summary>
    /// <param name="technology">"SSE", "WebSocket", "SignalR", "WebRTC", ...</param>
    /// <param name="eventName">e.g. "connection_open", "message_in", "poll_tick".</param>
    /// <param name="user">Optional username for correlation.</param>
    /// <param name="detail">Free-form text.</param>
    /// <param name="value">Optional numeric metric (latency ms, payload bytes, etc.).</param>
    public void Track(
        string technology,
        string eventName,
        string? user = null,
        string? detail = null,
        double? value = null)
    {
        // ---- 1. Application Insights ----------------------------------------
        // Group every demo's events under a common tag so dashboards can show
        // "messages per technology" with no extra config.
        var props = new Dictionary<string, string>
        {
            ["technology"] = technology,
            ["eventName"]  = eventName,
        };
        if (user is not null)   props["user"]   = user;
        if (detail is not null) props["detail"] = detail;

        if (value is double m)
        {
            // numeric → metric so we can chart it
            _ai.TrackMetric(new MetricTelemetry($"{technology}.{eventName}", m)
            {
                Properties = { ["technology"] = technology, ["eventName"] = eventName }
            });
        }
        else
        {
            _ai.TrackEvent(eventName, props);
        }

        _log.LogInformation(
            "Telemetry {Technology} {EventName} user={User} value={Value} detail={Detail}",
            technology, eventName, user, value, detail);

        // ---- 2. Local SQLite mirror ----------------------------------------
        // Fire-and-forget so DB latency never blocks the request path.
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.TelemetryEvents.Add(new TelemetryEvent
                {
                    Technology = technology,
                    EventName  = eventName,
                    User       = user,
                    Detail     = detail,
                    Value      = value,
                });
                await db.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Failed to persist telemetry to SQLite");
            }
        });
    }
}
