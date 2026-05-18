// =============================================================================
// AppDbContext
// -----------------------------------------------------------------------------
// EF Core DbContext for the Week 8 sample.
//
// We keep the data model deliberately small so the focus stays on the
// real-time communication technologies, not on persistence:
//
//   • Users          — accounts protected by basic-auth + JWT.
//   • ChatMessages   — messages exchanged via the SignalR hub.
//   • PollItems      — server-side items "produced" over time that polling
//                       endpoints expose to clients (also used by the SSE demo
//                       so all three streaming approaches share one source of
//                       truth).
//   • PushSubscriptions — VAPID-encrypted Web Push subscription endpoints.
//   • TelemetryEvents  — lightweight in-DB record of which demo / which
//                       technology was used and when (mirrors what we send to
//                       Application Insights so students can inspect locally).
// =============================================================================

using Microsoft.EntityFrameworkCore;
using RealtimeDemo.Api.Models;

namespace RealtimeDemo.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    // Users created via /api/auth/register and authenticated by /api/auth/login.
    public DbSet<User> Users => Set<User>();

    // Chat messages broadcast through the SignalR hub.
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();

    // The shared "event stream" that polling, long-polling, SSE, and HTTP
    // streaming all read from. Producing one event in /api/seed/produce-event
    // makes it visible to every demo simultaneously.
    public DbSet<PollItem> PollItems => Set<PollItem>();

    // Per-browser push subscriptions (endpoint + auth/p256dh keys).
    public DbSet<PushSubscription> PushSubscriptions => Set<PushSubscription>();

    // Local mirror of the telemetry we also publish to Application Insights.
    public DbSet<TelemetryEvent> TelemetryEvents => Set<TelemetryEvent>();

    protected override void OnModelCreating(ModelBuilder mb)
    {
        // Unique username for login.
        mb.Entity<User>().HasIndex(u => u.Username).IsUnique();

        // PushSubscription endpoint should be unique per row.
        mb.Entity<PushSubscription>().HasIndex(s => s.Endpoint).IsUnique();
    }
}
