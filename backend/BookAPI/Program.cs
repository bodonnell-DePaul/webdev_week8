using BookAPI.Models;
using Microsoft.OpenApi.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using System.Net.Http.Headers;
using System.Text;
using System.Security.Claims;
using BookAPI.Services;
using BookAPI.Data;
using Microsoft.EntityFrameworkCore;
using static BookAPI.Models.AuthModels;
using System.IdentityModel.Tokens.Jwt;
using Microsoft.IdentityModel.Tokens;
using Microsoft.AspNetCore.Authentication.Google;

var builder = WebApplication.CreateBuilder(args);

// Configure authentication with multiple schemes
builder.Services.AddAuthentication(options =>
{
    options.DefaultScheme = "JWT";
})
.AddJwtBearer("JWT", options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = "BookAPI",
        ValidAudience = "BookUsers",
        IssuerSigningKey = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes("YourSuperSecretKeyForBookApiThatIsLongEnough"))
    };
})
.AddCookie("ExternalCookies")
.AddGoogle(options =>
{
    // Get these values from Google Cloud Console
    options.ClientId = builder.Configuration["Authentication:Google:ClientId"];
    options.ClientSecret = builder.Configuration["Authentication:Google:ClientSecret"];

    // Set callback path to match your frontend
    options.CallbackPath = "/auth/google/callback";

    // Use the temporary cookie scheme
    options.SignInScheme = "ExternalCookies";

    // Add scopes as needed
    options.Scope.Add("profile");
    options.Scope.Add("email");

    // Map Google claims to standard claims
    options.ClaimActions.MapJsonKey(ClaimTypes.NameIdentifier, "sub");
    options.ClaimActions.MapJsonKey(ClaimTypes.Name, "name");
    options.ClaimActions.MapJsonKey(ClaimTypes.Email, "email");
});

// Add services to the container.
// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "Book API", Version = "v1" });
});


// Add CORS support
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowReactApp", policy =>
    {
        policy.AllowAnyOrigin() // Vite's default port
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// // Add services to the container.
builder.Services.AddControllers().AddJsonOptions(options =>
{
    options.JsonSerializerOptions.ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles;
    options.JsonSerializerOptions.WriteIndented = true;
});

// Add EF Core with SQLite
builder.Services.AddDbContext<BookDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("SqliteConnection")));

builder.Services.AddDbContext<UserDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("UserDbConnection")));
// Configure basic authentication
builder.Services.AddAuthentication("BasicAuthentication")
    .AddScheme<AuthenticationSchemeOptions, BookApiBasicAuthHandler>("BasicAuthentication", null);

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("BasicAuthentication", policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.RequireClaim(ClaimTypes.NameIdentifier);
    });
});

// Add services
builder.Services.AddScoped<IUserService, UserService>();

var app = builder.Build();

// Configure middleware
app.UseCors("AllowReactApp");

// Ensure database is created with seed data
using (var scope = app.Services.CreateScope())
{
    var bookDbContext = scope.ServiceProvider.GetRequiredService<BookDbContext>();
    bookDbContext.Database.EnsureCreated();

    var userDbContext = scope.ServiceProvider.GetRequiredService<UserDbContext>();
    userDbContext.Database.EnsureCreated();
}
// Add usage before your existing endpoints
app.UseAuthentication();
app.UseAuthorization();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.MapControllers();

app.MapGet("/HelloWorld", () =>
{
    return "Hello World!";
})
.WithName("HelloWorld")
.WithOpenApi();

//Setup APIs
app.MapGet("/init", (UserDbContext udb) =>
{
    User u = new User
    {
        Id = 1,
        Name = "Admin",
        Email = "admin@bodonnell.com",
        Password = "password",
        CreatedAt = DateTime.UtcNow
    };
    udb.Users.Add(u);
    udb.SaveChanges();
    udb.Database.ExecuteSqlRaw("PRAGMA wal_checkpoint;");

    return Results.Ok(new { message = "API is running" });
});

// OAuth endpoints and handlers
app.MapGet("/auth/google", () => Results.Challenge(
    new AuthenticationProperties { RedirectUri = "http://localhost:5173/login" },
    new[] { GoogleDefaults.AuthenticationScheme })
);

// Handle the OAuth callback and generate JWT tokens
app.MapPost("/auth/google/callback", async (HttpContext context, string code) =>
{
    // For a real implementation, handle the authorization code exchange
    // Here we're simplifying by assuming the user is already authenticated via cookies
    
    var authenticateResult = await context.AuthenticateAsync("ExternalCookies");
    if (!authenticateResult.Succeeded)
    {
        return Results.Unauthorized();
    }

    var claims = authenticateResult.Principal.Claims.ToList();
    var email = claims.FirstOrDefault(c => c.Type == ClaimTypes.Email)?.Value;
    
    if (string.IsNullOrEmpty(email))
    {
        return Results.BadRequest("Email claim not found");
    }
    
    // Generate JWT token
    var tokenHandler = new JwtSecurityTokenHandler();
    var key = Encoding.UTF8.GetBytes("YourSuperSecretKeyForBookApiThatIsLongEnough");
    
    var tokenDescriptor = new SecurityTokenDescriptor
    {
        Subject = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.Email, email),
            new Claim(ClaimTypes.Name, claims.FirstOrDefault(c => c.Type == ClaimTypes.Name)?.Value ?? email),
            new Claim(ClaimTypes.NameIdentifier, claims.FirstOrDefault(c => c.Type == ClaimTypes.NameIdentifier)?.Value ?? ""),
            new Claim(ClaimTypes.Role, "User"), // Default role
        }),
        Expires = DateTime.UtcNow.AddHours(1),
        Issuer = "BookAPI",
        Audience = "BookUsers",
        SigningCredentials = new SigningCredentials(
            new SymmetricSecurityKey(key), 
            SecurityAlgorithms.HmacSha256Signature)
    };
    
    var token = tokenHandler.CreateToken(tokenDescriptor);
    
    // Sign out of the external cookie scheme
    await context.SignOutAsync("ExternalCookies");
    
    return Results.Ok(new
    {
        accessToken = tokenHandler.WriteToken(token),
        refreshToken = Convert.ToBase64String(Guid.NewGuid().ToByteArray())
    });
});


// GET - Get all books
app.MapGet("/api/books", async (BookDbContext db) =>
    await db.Books.ToListAsync())
   .WithName("GetAllBooks");

// GET - Get all books with publishers
app.MapGet("/api/publisherbooks", async (BookDbContext db) =>
     await db.Books.Include(b => b.Publisher).ToListAsync())
     .WithName("GetAllPublisherBooks").RequireAuthorization();

// GET - Get a specific book by ID
app.MapGet("/api/books/{id}", async (int id, BookDbContext db) =>
{
    var book = await db.Books.FindAsync(id);
    return book == null ? Results.NotFound() : Results.Ok(book);
})
.WithName("GetBookById");

// POST - Add a new book
app.MapPost("/api/books", async (Book book, BookDbContext db) =>
{
    db.Books.Add(book);
    await db.SaveChangesAsync();
    return Results.Created($"/api/books/{book.Id}", book);
})
.WithName("AddBook");

// PUT - Update a book
app.MapPut("/api/books/{id}", async (int id, Book updatedBook, BookDbContext db) =>
{
    var book = await db.Books.FindAsync(id);
    if (book == null) return Results.NotFound();
    
    book.Title = updatedBook.Title;
    book.Author = updatedBook.Author;
    book.Year = updatedBook.Year;
    book.Genre = updatedBook.Genre;
    book.IsAvailable = updatedBook.IsAvailable;
    
    await db.SaveChangesAsync();
    return Results.NoContent();
})
.WithName("UpdateBook");

// PATCH - Update book availability
app.MapPatch("/api/books/{id}/availability", async (int id, bool isAvailable, BookDbContext db) =>
{
    var book = await db.Books.FindAsync(id);
    if (book == null) return Results.NotFound();
    
    book.IsAvailable = isAvailable;
    await db.SaveChangesAsync();
    return Results.NoContent();
})
.WithName("UpdateBookAvailability");

// DELETE - Delete a book
app.MapDelete("/api/books/{id}", async (int id, BookDbContext db) =>
{
    var book = await db.Books.FindAsync(id);
    if (book == null) return Results.NotFound();
    
    db.Books.Remove(book);
    await db.SaveChangesAsync();
    return Results.NoContent();
})
.WithName("DeleteBook");


// New User Registration API
app.MapPost("/api/register", async (User user, UserDbContext udb) =>
{
    // Check if the user already exists
    var existingUser = await udb.Users.FirstOrDefaultAsync(u => u.Email == user.Email);
    if (existingUser != null)
    {
        return Results.BadRequest("User already exists.");
    }

    // Add the new user to the database
    udb.Users.Add(user);
    await udb.SaveChangesAsync();
    return Results.Created($"/api/users/{user.Id}", user);
});

// Auth endpoints
app.MapPost("/api/login", (LoginRequest request) =>
{
    // Demo implementation - in a real app, verify against database
    if (request.Email != "admin@example.com" || request.Password != "password")
        return Results.Unauthorized();

    var tokenHandler = new JwtSecurityTokenHandler();
    var key = Encoding.UTF8.GetBytes("YourSuperSecretKeyForBookApiThatIsLongEnough");
    
    var tokenDescriptor = new SecurityTokenDescriptor
    {
        Subject = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.Name, request.Email),
            new Claim(ClaimTypes.Role, "Admin"),
        }),
        Expires = DateTime.UtcNow.AddHours(1),
        Issuer = "BookAPI",
        Audience = "BookUsers",
        SigningCredentials = new SigningCredentials(
            new SymmetricSecurityKey(key), 
            SecurityAlgorithms.HmacSha256Signature)
    };
    
    var token = tokenHandler.CreateToken(tokenDescriptor);
    
    return Results.Ok(new
    {
        accessToken = tokenHandler.WriteToken(token),
        refreshToken = Convert.ToBase64String(Guid.NewGuid().ToByteArray())
    });
});

app.Run();
