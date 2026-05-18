// =============================================================================
// AuthController
// -----------------------------------------------------------------------------
// Supports TWO authentication patterns demonstrated to students:
//
//   1. JWT Bearer (preferred for SPA + fetch/WebSocket/SignalR/HTTP-streaming).
//      • POST /api/auth/register  — create account
//      • POST /api/auth/login     — basic-auth header validated, JWT returned
//
//   2. Basic-Auth fallback (for tools and the SSE demo, since EventSource
//      cannot send a custom Authorization header — see lecture §6.4).
//      • The middleware in Program.cs accepts `Authorization: Basic <b64>`
//        on the SSE endpoint as a fallback, so students can compare auth
//        differences across transports.
//
// JWT lifetime is intentionally short (60 minutes) for class purposes.
// =============================================================================

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using RealtimeDemo.Api.Auth;
using RealtimeDemo.Api.Data;
using RealtimeDemo.Api.Models;
using RealtimeDemo.Api.Telemetry;

namespace RealtimeDemo.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _cfg;
    private readonly TelemetryService _tele;

    public AuthController(AppDbContext db, IConfiguration cfg, TelemetryService tele)
    {
        _db = db; _cfg = cfg; _tele = tele;
    }

    public record AuthRequest(string Username, string Password);
    public record AuthResponse(string Username, string Token, DateTime ExpiresAt);

    // ----- Register ----------------------------------------------------------
    // Creates the user and immediately returns a usable JWT so the SPA can sign
    // the new user in without a second request.
    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register([FromBody] AuthRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Username) || req.Password?.Length < 4)
            return BadRequest("Username + password (>=4 chars) required.");

        if (await _db.Users.AnyAsync(u => u.Username == req.Username))
            return Conflict("Username already taken.");

        var user = new User
        {
            Username = req.Username.Trim(),
            PasswordHash = PasswordHasher.Hash(req.Password!),
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        _tele.Track("Auth", "user_registered", user: user.Username);
        return Ok(IssueToken(user));
    }

    // ----- Login -------------------------------------------------------------
    // Accepts either a JSON body OR a Basic auth header. Returns a JWT.
    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login([FromBody] AuthRequest? req)
    {
        string? username = req?.Username;
        string? password = req?.Password;

        // If JSON body absent, parse a Basic auth header — this lets curl /
        // demos use either style.
        if ((username is null || password is null) &&
            Request.Headers.TryGetValue("Authorization", out var hdr) &&
            hdr.ToString().StartsWith("Basic ", StringComparison.OrdinalIgnoreCase))
        {
            var b64 = hdr.ToString()["Basic ".Length..];
            var raw = Encoding.UTF8.GetString(Convert.FromBase64String(b64));
            var parts = raw.Split(':', 2);
            if (parts.Length == 2)
            {
                username = parts[0];
                password = parts[1];
            }
        }

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrEmpty(password))
            return BadRequest("Missing credentials.");

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Username == username);
        if (user is null || !PasswordHasher.Verify(password, user.PasswordHash))
        {
            _tele.Track("Auth", "login_failed", user: username);
            return Unauthorized();
        }

        _tele.Track("Auth", "login_success", user: user.Username);
        return Ok(IssueToken(user));
    }

    // ----- Token issuance ----------------------------------------------------
    private AuthResponse IssueToken(User u)
    {
        var jwtKey   = _cfg["Jwt:Key"]   ?? "DEV_INSECURE_KEY_PLEASE_OVERRIDE_32B_xxxx";
        var jwtIss   = _cfg["Jwt:Issuer"]   ?? "RealtimeDemo";
        var jwtAud   = _cfg["Jwt:Audience"] ?? "RealtimeDemo";

        var creds = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, u.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.UniqueName, u.Username),
            new Claim(ClaimTypes.Name, u.Username),
        };

        var expires = DateTime.UtcNow.AddMinutes(60);
        var token = new JwtSecurityToken(
            issuer: jwtIss, audience: jwtAud,
            claims: claims, expires: expires,
            signingCredentials: creds);

        return new AuthResponse(
            u.Username,
            new JwtSecurityTokenHandler().WriteToken(token),
            expires);
    }
}
