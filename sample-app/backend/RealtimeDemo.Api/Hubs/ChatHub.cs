// =============================================================================
// ChatHub  (SignalR)
// -----------------------------------------------------------------------------
// Demonstrates SignalR with:
//   • a hub method `SendMessage(text)` — broadcast to everyone
//   • `JoinRoom(name)`/`LeaveRoom(name)` — group management
//   • `SendToRoom(name, text)` — group broadcast
//   • lifecycle hooks (`OnConnectedAsync` / `OnDisconnectedAsync`)
//   • automatic message persistence to EF Core
//   • SignalR is also used as the *signaling* channel for the WebRTC demo —
//     see `RelaySignal(targetConnectionId, payload)` below.
//
// Hub mapping is configured in Program.cs (MapHub<ChatHub>).
// =============================================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using RealtimeDemo.Api.Data;
using RealtimeDemo.Api.Models;
using RealtimeDemo.Api.Telemetry;

namespace RealtimeDemo.Api.Hubs;

[Authorize] // JWT bearer token required (passed via ?access_token=... for WS).
public class ChatHub : Hub
{
    private readonly AppDbContext _db;
    private readonly TelemetryService _tele;
    private readonly ILogger<ChatHub> _log;

    public ChatHub(AppDbContext db, TelemetryService tele, ILogger<ChatHub> log)
    {
        _db = db; _tele = tele; _log = log;
    }

    private string Who => Context.User?.Identity?.Name ?? "anon";

    // ---- Lifecycle ---------------------------------------------------------

    public override async Task OnConnectedAsync()
    {
        _tele.Track("SignalR", "connected", user: Who, detail: Context.ConnectionId);
        // Tell every client about the new presence.
        await Clients.All.SendAsync("UserConnected", Who, Context.ConnectionId);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _tele.Track("SignalR", "disconnected", user: Who, detail: exception?.Message);
        await Clients.All.SendAsync("UserDisconnected", Who, Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    // ---- Broadcast / persisted chat ---------------------------------------

    public async Task SendMessage(string text)
    {
        var msg = new ChatMessage { User = Who, Text = text ?? "" };
        _db.ChatMessages.Add(msg);
        await _db.SaveChangesAsync();

        _tele.Track("SignalR", "broadcast", user: Who, detail: text, value: text?.Length);
        await Clients.All.SendAsync("ReceiveMessage", msg.User, msg.Text, msg.SentAt);
    }

    public async Task<IEnumerable<object>> GetHistory(int take = 50)
    {
        // Demonstrates SignalR returning data via a return value (RPC-style).
        var list = _db.ChatMessages
            .OrderByDescending(m => m.Id)
            .Take(Math.Clamp(take, 1, 200))
            .OrderBy(m => m.Id)
            .Select(m => new { m.User, m.Text, m.SentAt })
            .ToList();
        _tele.Track("SignalR", "history_requested", user: Who, value: list.Count);
        return list;
    }

    public async Task Typing(bool isTyping)
    {
        await Clients.Others.SendAsync("Typing", Who, isTyping);
    }

    // ---- Groups -----------------------------------------------------------

    public async Task JoinRoom(string room)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, room);
        _tele.Track("SignalR", "room_joined", user: Who, detail: room);
        await Clients.Group(room).SendAsync("RoomJoined", room, Who);
    }

    public async Task LeaveRoom(string room)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, room);
        _tele.Track("SignalR", "room_left", user: Who, detail: room);
        await Clients.Group(room).SendAsync("RoomLeft", room, Who);
    }

    public async Task SendToRoom(string room, string text)
    {
        _tele.Track("SignalR", "room_broadcast", user: Who, detail: $"{room}: {text}");
        await Clients.Group(room).SendAsync("ReceiveRoomMessage", room, Who, text, DateTime.UtcNow);
    }

    // ---- WebRTC signaling relay ------------------------------------------
    // SignalR is *not* WebRTC, but it is a natural place to put the signaling
    // channel that WebRTC requires. Students see both technologies cooperating
    // exactly as production systems do.
    public async Task RelaySignal(string targetConnectionId, object payload)
    {
        _tele.Track("WebRTC", "signal_relay", user: Who, detail: targetConnectionId);
        await Clients.Client(targetConnectionId).SendAsync(
            "WebRTCSignal", Context.ConnectionId, Who, payload);
    }
}
