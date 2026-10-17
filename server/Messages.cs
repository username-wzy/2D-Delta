// Messages.cs - WebSocket message protocol definitions
using System.Text.Json;
using System.Text.Json.Serialization;

namespace EmojiDelta.Server;

public static class Messages
{
    public static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        NumberHandling = JsonNumberHandling.AllowReadingFromString
    };

    // --- Client → Server ---
    public record C2S_Input(
        int Seq,
        float Dt,
        bool W, bool A, bool S, bool D,
        bool Sprint,
        float MouseWorldX, float MouseWorldY,
        bool Fire, float FireAngle,
        bool Interact
    );

    public record C2S_Deploy(string PlayerName);

    // --- Server → Client ---
    public record S2C_Snapshot(
        int Tick,
        long ServerTime,
        int LastProcessedSeq,
        float ServerX, float ServerY,
        List<EntityState> Entities,
        List<SoundEvent> Sounds,
        float Hp = 0, float Armor = 0, int Ammo = 0, int ReserveAmmo = 0,
        string Phase = "Lobby"
    ) { public string Type => "SNAPSHOT"; }

    public record EntityState(
        string Id,
        string Type,   // "player" | "bot" | "loot" | "wall"
        string Emoji,
        float X, float Y,
        float Hp, float MaxHp,
        bool IsDead
    );

    public record SoundEvent(
        float X, float Y,
        float Radius,
        string Type  // "gunshot" | "explosion"
    );

    public record S2C_MapInit(
        int WorldWidth, int WorldHeight,
        int TileSize,
        float SpawnX, float SpawnY,
        List<WallData> Walls,
        ExtractionData Extraction
    ) { public string Type => "MAP_INIT"; }

    public record WallData(int X, int Y, int W, int H, string Emoji, bool BlockingLoS);
    public record ExtractionData(float X, float Y, float W, float H, string Emoji);

    public record S2C_GameEvent(
        string Event,      // "player_killed" | "extraction_start" | "extraction_complete" | "extraction_cancel"
        string Message,
        object? Data = null,
        string? PlayerId = null
    ) { public string Type => "GAME_EVENT"; }

    public record S2C_Error(string Code, string Message);
}
