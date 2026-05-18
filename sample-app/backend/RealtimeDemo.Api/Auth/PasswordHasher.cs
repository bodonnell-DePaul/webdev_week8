// =============================================================================
// PasswordHasher
// -----------------------------------------------------------------------------
// Tiny PBKDF2-SHA256 password hasher with a per-user random salt.
//
// Format stored in DB: "<iterations>.<base64-salt>.<base64-hash>"
//
// This is deliberately hand-rolled (instead of using ASP.NET Identity) to keep
// the sample compact and educational. In production prefer Identity or libsodium.
// =============================================================================

using System.Security.Cryptography;

namespace RealtimeDemo.Api.Auth;

public static class PasswordHasher
{
    private const int Iterations = 100_000;   // PBKDF2 iteration count
    private const int SaltBytes  = 16;        // 128-bit salt
    private const int HashBytes  = 32;        // 256-bit hash output

    public static string Hash(string password)
    {
        // Random salt for every user.
        byte[] salt = RandomNumberGenerator.GetBytes(SaltBytes);

        // Derive 32-byte key with PBKDF2-SHA256.
        byte[] hash = Rfc2898DeriveBytes.Pbkdf2(
            password,
            salt,
            Iterations,
            HashAlgorithmName.SHA256,
            HashBytes);

        return $"{Iterations}.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string stored)
    {
        var parts = stored.Split('.');
        if (parts.Length != 3) return false;
        if (!int.TryParse(parts[0], out var iter)) return false;

        byte[] salt   = Convert.FromBase64String(parts[1]);
        byte[] expect = Convert.FromBase64String(parts[2]);

        byte[] actual = Rfc2898DeriveBytes.Pbkdf2(
            password, salt, iter, HashAlgorithmName.SHA256, expect.Length);

        // Constant-time comparison to avoid timing attacks.
        return CryptographicOperations.FixedTimeEquals(actual, expect);
    }
}
