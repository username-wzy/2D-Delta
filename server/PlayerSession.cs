// PlayerSession.cs - Per-player authoritative state
using System.Net.WebSockets;
using System.Threading.Channels;

namespace EmojiDelta.Server;

public class PlayerSession
{
    public string Id { get; } = Guid.NewGuid().ToString("N")[..12];
    public WebSocket Socket { get; set; } = null!;
    public string PlayerName { get; set; } = "Operator";
    public RaidPhase Phase { get; set; } = RaidPhase.Lobby;
    public Channel<object> Outgoing { get; } = Channel.CreateBounded<object>(new BoundedChannelOptions(64) { SingleReader = true, FullMode = BoundedChannelFullMode.Wait });
    public int LastReceivedSeq { get; set; }
    public int InputSeq { get; set; }
    public int LastInputTick { get; set; }
    public bool MoveW { get; set; }
    public bool MoveA { get; set; }
    public bool MoveS { get; set; }
    public bool MoveD { get; set; }
    public bool SprintInput { get; set; }
    public bool FireInput { get; set; }
    public float FireAngle { get; set; }
    public bool ReloadRequested { get; set; }
    public bool InteractRequested { get; set; }
    public long RateWindowStart { get; set; } = System.Diagnostics.Stopwatch.GetTimestamp();
    public int MessagesInWindow { get; set; }

    // Authoritative position
    public float X { get; set; }
    public float Y { get; set; }
    public float Size { get; set; } = 48f;
    public string Emoji { get; set; } = "🥷";

    // Stats
    public float Hp { get; set; } = 100f;
    public float MaxHp { get; set; } = 100f;
    public float Armor { get; set; } = 80f;
    public float MaxArmor { get; set; } = 80f;
    public int ArmorClass { get; set; } = 4;
    public float Stamina { get; set; } = 100f;
    public float MaxStamina { get; set; } = 100f;

    // Movement config
    public float BaseSpeed { get; set; } = 300f;
    public float SprintMultiplier { get; set; } = 1.6f;
    public bool IsSprinting { get; set; }
    public float Spread { get; set; } = 0.02f;

    // Weapon
    public GunState Gun { get; set; } = new();
    public class GunState
    {
        public string Name { get; set; } = "TAC-SMG";
        public float Damage { get; set; } = 28f;
        public float Penetration { get; set; } = 35f;
        public float FireRate { get; set; } = 0.08f;
        public float Cooldown { get; set; }
        public int MagSize { get; set; } = 30;
        public int CurrentAmmo { get; set; } = 30;
        public int MaxAmmo { get; set; } = 120;
        public bool IsReloading { get; set; }
        public float ReloadTime { get; set; } = 1.8f;
        public float ReloadTimer { get; set; }
    }

    // Input sequencing
    public int LastProcessedSeq { get; set; }
    public DateTime LastInputTime { get; set; } = DateTime.UtcNow;
    public float InputDeltaTime { get; set; }

    // Extraction
    public bool IsExtracting { get; set; }
    public float ExtractTimer { get; set; }
    public const float ExtractDuration = 10f;

    // Inventory
    public List<LootItem> Inventory { get; set; } = new();
    public int MaxSlots { get; set; } = 12;

    public record LootItem(string Id, string Type, string Emoji, string Name);

    // Anti-cheat
    public float SuspiciousActivity { get; set; }
    public const float MaxAllowedSpeed = 540f; // baseSpeed * sprintMultiplier * 1.1 tolerance
}

public enum RaidPhase { Lobby, InRaid, Dead, Extracted }
