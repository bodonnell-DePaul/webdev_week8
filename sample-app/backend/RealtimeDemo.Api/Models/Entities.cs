// =============================================================================
// Entity models
// -----------------------------------------------------------------------------
// One file with all small DTOs / entities. Each row is heavily commented so the
// students can map fields back to the technology that uses them.
// =============================================================================

using System.ComponentModel.DataAnnotations;

namespace RealtimeDemo.Api.Models;

// -----------------------------------------------------------------------------
// User account (basic auth + JWT).
// -----------------------------------------------------------------------------
public class User
{
    public int Id { get; set; }

    // Login name. Indexed unique (see AppDbContext.OnModelCreating).
    [Required, MaxLength(64)]
    public string Username { get; set; } = "";

    // We hash passwords with PBKDF2 (see Auth/PasswordHasher.cs).
    [Required]
    public string PasswordHash { get; set; } = "";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// -----------------------------------------------------------------------------
// ChatMessage — persisted history for the SignalR demo.
// -----------------------------------------------------------------------------
public class ChatMessage
{
    public int Id { get; set; }
    [Required, MaxLength(64)] public string User { get; set; } = "";
    [Required, MaxLength(2000)] public string Text { get; set; } = "";
    public DateTime SentAt { get; set; } = DateTime.UtcNow;
}

// -----------------------------------------------------------------------------
// PollItem — one event in the shared timeline.
//
// The /polling, /sse, and /streaming demo pages all read from this table so
// students can compare transport behavior using *the same* data source.
// -----------------------------------------------------------------------------
public class PollItem
{
    public int Id { get; set; }
    [Required, MaxLength(2000)] public string Message { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// -----------------------------------------------------------------------------
// PushSubscription — VAPID Web Push subscription endpoint for one browser.
// -----------------------------------------------------------------------------
public class PushSubscription
{
    public int Id { get; set; }
    [Required] public string Endpoint { get; set; } = "";   // unique URL
    [Required] public string P256dh   { get; set; } = "";   // public key
    [Required] public string Auth     { get; set; } = "";   // auth secret
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// -----------------------------------------------------------------------------
// TelemetryEvent — local DB mirror of what we publish to Application Insights.
//
// Every demo page calls TelemetryService.Track(...) which:
//   1. emits a TrackEvent / TrackMetric to App Insights, AND
//   2. inserts a row here so students can see telemetry even with no AI key.
// -----------------------------------------------------------------------------
public class TelemetryEvent
{
    public int Id { get; set; }
    [Required, MaxLength(64)] public string Technology { get; set; } = ""; // "SSE", "WebSocket", ...
    [Required, MaxLength(64)] public string EventName  { get; set; } = ""; // "connection_open", "message_in", ...
    [MaxLength(64)]            public string? User      { get; set; }
    [MaxLength(2000)]          public string? Detail    { get; set; }
    public double? Value { get; set; }                                     // optional metric (latency ms, bytes, etc.)
    public DateTime At { get; set; } = DateTime.UtcNow;
}
