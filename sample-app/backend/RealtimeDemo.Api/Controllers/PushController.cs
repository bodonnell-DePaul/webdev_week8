// =============================================================================
// PushController
// -----------------------------------------------------------------------------
// Demonstrates Web Push (VAPID) end-to-end.
//
//   GET  /api/push/vapid-public-key
//        Returns the VAPID public key so the browser can subscribe.
//
//   POST /api/push/subscribe
//        Body: { endpoint, p256dh, auth } — stores the subscription.
//
//   POST /api/push/send
//        Body: { title, body, url }
//        Server sends a notification to *every* subscription. (For class
//        purposes; production would target a specific user.)
//
// A throw-away dev VAPID key-pair is generated at startup if none configured;
// see Program.cs.
// =============================================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RealtimeDemo.Api.Data;
using RealtimeDemo.Api.Models;
using RealtimeDemo.Api.Telemetry;
using WebPush;

namespace RealtimeDemo.Api.Controllers;

[ApiController]
[Route("api/push")]
public class PushController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly TelemetryService _tele;
    private readonly VapidDetails _vapid;
    private readonly ILogger<PushController> _log;

    public PushController(AppDbContext db, TelemetryService tele, VapidDetails vapid, ILogger<PushController> log)
    {
        _db = db; _tele = tele; _vapid = vapid; _log = log;
    }

    // The public key is needed BEFORE login (so it's [AllowAnonymous]). The
    // private key is only on the server.
    [HttpGet("vapid-public-key")]
    [AllowAnonymous]
    public IActionResult PublicKey() => Ok(new { publicKey = _vapid.PublicKey });

    public record SubscribeRequest(string Endpoint, string P256dh, string Auth);

    [HttpPost("subscribe")]
    [Authorize]
    public async Task<IActionResult> Subscribe([FromBody] SubscribeRequest req)
    {
        var existing = await _db.PushSubscriptions
            .FirstOrDefaultAsync(s => s.Endpoint == req.Endpoint);

        if (existing is null)
        {
            _db.PushSubscriptions.Add(new Models.PushSubscription
            {
                Endpoint = req.Endpoint,
                P256dh   = req.P256dh,
                Auth     = req.Auth,
            });
        }
        else
        {
            existing.P256dh = req.P256dh;
            existing.Auth   = req.Auth;
        }

        await _db.SaveChangesAsync();
        _tele.Track("WebPush", "subscribed", user: User?.Identity?.Name);
        return Ok(new { subscribed = true });
    }

    public record SendRequest(string Title, string Body, string? Url);

    [HttpPost("send")]
    [Authorize]
    public async Task<IActionResult> Send([FromBody] SendRequest req)
    {
        var client = new WebPushClient();
        var subs = await _db.PushSubscriptions.ToListAsync();
        var payload = System.Text.Json.JsonSerializer.Serialize(new
        {
            title = req.Title ?? "Hello",
            body  = req.Body  ?? "",
            url   = req.Url   ?? "/",
        });

        var sent = 0;
        var failed = 0;
        foreach (var s in subs)
        {
            try
            {
                await client.SendNotificationAsync(
                    new WebPush.PushSubscription(s.Endpoint, s.P256dh, s.Auth),
                    payload,
                    _vapid);
                sent++;
            }
            catch (WebPushException ex)
            {
                failed++;
                _log.LogWarning("Push failed (will remove): {Msg}", ex.Message);
                // 404/410 means the subscription is gone — clean it up.
                if ((int)ex.StatusCode is 404 or 410)
                {
                    _db.PushSubscriptions.Remove(s);
                }
            }
        }
        await _db.SaveChangesAsync();

        _tele.Track("WebPush", "send", user: User?.Identity?.Name,
                    detail: req.Title, value: sent);

        return Ok(new { sent, failed });
    }
}
