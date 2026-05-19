// =============================================================================
// Program.cs — Week 8 Real-Time Demo (ASP.NET Core, .NET 10)
// -----------------------------------------------------------------------------
// Single composition root demonstrating every technology covered in the
// lecture. Each section is commented so students can read top-to-bottom and
// see exactly which lecture topic it serves.
// =============================================================================

using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using RealtimeDemo.Api;
using RealtimeDemo.Api.Data;
using RealtimeDemo.Api.Hubs;
using RealtimeDemo.Api.Telemetry;
using WebPush;

var builder = WebApplication.CreateBuilder(args);

// -----------------------------------------------------------------------------
// CORS — frontend runs on a separate Vite dev server (default 5173).
// We allow it explicitly. For SignalR/WebSockets credentials are required.
// -----------------------------------------------------------------------------
builder.Services.AddCors(o =>
{
    o.AddDefaultPolicy(p => p
        .WithOrigins(
            "http://localhost:5173", "http://127.0.0.1:5173",
            "http://localhost:5174", "http://127.0.0.1:5174",
            "http://localhost:4173", "http://127.0.0.1:4173")
        .AllowAnyMethod()
        .AllowAnyHeader()
        .AllowCredentials());
});

// -----------------------------------------------------------------------------
// MVC + OpenAPI
// -----------------------------------------------------------------------------
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();


// -----------------------------------------------------------------------------
// SignalR — built-in to ASP.NET Core. JSON protocol is the default; in
// production you might also enable MessagePack for performance.
// -----------------------------------------------------------------------------
builder.Services.AddSignalR(o =>
{
    // Useful in class so we see errors instead of generic messages.
    o.EnableDetailedErrors = true;
});

// -----------------------------------------------------------------------------
// EF Core — SQLite for portability (no server install required).
// -----------------------------------------------------------------------------
var dbPath = builder.Configuration["Db:Path"]
             ?? Path.Combine(builder.Environment.ContentRootPath, "realtimedemo.db");
builder.Services.AddDbContext<AppDbContext>(o => o.UseSqlite($"Data Source={dbPath}"));

// -----------------------------------------------------------------------------
// JWT Bearer auth
//
// IMPORTANT: For browser EventSource (SSE) and raw WebSocket, the JWT cannot
// be sent via the Authorization header. We therefore configure the JWT
// middleware to ALSO accept a `?access_token=...` query string parameter on
// the SSE, WS, and SignalR-hub paths. This is the standard ASP.NET Core
// pattern (see docs).
// -----------------------------------------------------------------------------
var jwtKey = builder.Configuration["Jwt:Key"]
             ?? "DEV_INSECURE_KEY_PLEASE_OVERRIDE_32B_xxxx";   // length >= 32 chars
var jwtIss = builder.Configuration["Jwt:Issuer"]   ?? "RealtimeDemo";
var jwtAud = builder.Configuration["Jwt:Audience"] ?? "RealtimeDemo";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.RequireHttpsMetadata = false; // dev-only
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateIssuerSigningKey = true,
            ValidateLifetime = true,
            ValidIssuer = jwtIss,
            ValidAudience = jwtAud,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ClockSkew = TimeSpan.FromMinutes(1),
        };
        o.Events = new JwtBearerEvents
        {
            // Allow access_token in query string for SSE / WS / SignalR.
            OnMessageReceived = ctx =>
            {
                var t = ctx.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(t))
                {
                    var path = ctx.HttpContext.Request.Path;
                    if (path.StartsWithSegments("/api/sse") ||
                        path.StartsWithSegments("/ws") ||
                        path.StartsWithSegments("/hubs"))
                    {
                        ctx.Token = t;
                    }
                }
                return Task.CompletedTask;
            }
        };
    });
builder.Services.AddAuthorization();

// -----------------------------------------------------------------------------
// Application Insights
//
// If you set ApplicationInsights:ConnectionString in appsettings.json (or
// APPLICATIONINSIGHTS_CONNECTION_STRING env var), telemetry is published live.
// If not, we register a no-op TelemetryClient so injection still works and
// every demo can call _ai.TrackEvent(...) safely — telemetry simply stays
// local (mirrored in the TelemetryEvents table).
// -----------------------------------------------------------------------------
var aiConn = builder.Configuration["ApplicationInsights:ConnectionString"];
if (!string.IsNullOrWhiteSpace(aiConn))
{
    builder.Services.AddApplicationInsightsTelemetry(o => o.ConnectionString = aiConn);
}
else
{
    // Register a passive client so DI keeps working with no live telemetry.
    builder.Services.AddSingleton(_ =>
        new Microsoft.ApplicationInsights.TelemetryClient(
            new Microsoft.ApplicationInsights.Extensibility.TelemetryConfiguration()));
}
builder.Services.AddSingleton<TelemetryService>();

// -----------------------------------------------------------------------------
// VAPID / Web Push key-pair
//
// In production these are configured. For class we auto-generate a dev pair
// on first startup and persist to disk so the same browser subscription
// remains valid across restarts.
// -----------------------------------------------------------------------------
builder.Services.AddSingleton(sp =>
{
    var cfg = sp.GetRequiredService<IConfiguration>();
    var subject = cfg["Vapid:Subject"]   ?? "mailto:teacher@example.edu";
    var pub     = cfg["Vapid:PublicKey"];
    var prv     = cfg["Vapid:PrivateKey"];

    var keyFile = Path.Combine(builder.Environment.ContentRootPath, "vapid.json");
    if (string.IsNullOrEmpty(pub) || string.IsNullOrEmpty(prv))
    {
        if (File.Exists(keyFile))
        {
            var saved = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(
                File.ReadAllText(keyFile))!;
            pub = saved["public"];
            prv = saved["private"];
        }
        else
        {
            var keys = VapidHelper.GenerateVapidKeys();
            pub = keys.PublicKey;
            prv = keys.PrivateKey;
            File.WriteAllText(keyFile, System.Text.Json.JsonSerializer.Serialize(new
            {
                @public = pub,
                @private = prv,
            }));
        }
    }
    return new VapidDetails(subject, pub, prv);
});

// -----------------------------------------------------------------------------
// Forwarded headers — useful behind reverse proxies / tunnels.
// -----------------------------------------------------------------------------
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
});

// -----------------------------------------------------------------------------
// Build & migrate DB
// -----------------------------------------------------------------------------
var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    // EnsureCreated keeps the sample simple — no migrations to run.
    db.Database.EnsureCreated();
}

if (app.Environment.IsDevelopment())
{
    
}

app.UseForwardedHeaders();
app.UseCors();

// -----------------------------------------------------------------------------
// WebSockets must be enabled in the pipeline BEFORE the WS endpoint mapping.
// -----------------------------------------------------------------------------
app.UseWebSockets(new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromSeconds(30),
});

app.UseAuthentication();
app.UseAuthorization();

// REST controllers — Auth, Polling, SSE, HttpStreaming, Push, Telemetry.
app.MapControllers();

// SignalR hub (used for chat + WebRTC signaling).
app.MapHub<ChatHub>("/hubs/chat");

// Raw WebSocket echo endpoint.
app.MapEchoWebSocket("/ws/echo");

// Simple health endpoint for smoke tests.
app.MapGet("/api/health", () => Results.Ok(new { ok = true, at = DateTime.UtcNow }));

app.Run();

// Top-level Program made partial so a future WebApplicationFactory<>-based
// test project could reference it; left here as a teaching nudge.
public partial class Program { }
