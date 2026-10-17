// GameWorld.cs - Authoritative world state, collision, entity management
using System.Collections.Concurrent;

namespace EmojiDelta.Server;

public class GameWorld
{
    public const int WorldWidth = 3200;
    public const int WorldHeight = 2400;
    public const int TileSize = 64;
    private const float BotViewRange = 400f;
    private const float BotAggroRange = 350f;
    private const float BotMeleeRange = 60f;

    private readonly Random _rng = new();
    private readonly SpatialHash<BotState> _botHash = new(TileSize);
    private readonly SpatialHash<WallData> _wallHash = new(TileSize);
    private readonly List<BotState> _bots = new();
    private readonly List<WallData> _walls = new();
    private readonly List<LootState> _loots = new();

    public IReadOnlyList<BotState> Bots => _bots;
    public IReadOnlyList<WallData> Walls => _walls;
    public IReadOnlyList<LootState> Loots => _loots;
    public (float X, float Y, float W, float H, string Emoji) Extraction { get; }

    public GameWorld()
    {
        Extraction = (WorldWidth - 400f, 300f, 220f, 220f, "🚁");
        GenerateWorld();
    }

    private void GenerateWorld()
    {
        _walls.Clear();
        _bots.Clear();
        _loots.Clear();
        _botHash.Clear();
        _wallHash.Clear();

        // Borders
        AddWall(new(-TileSize, -TileSize, WorldWidth + TileSize * 2, TileSize, "🧱", true));
        AddWall(new(-TileSize, WorldHeight, WorldWidth + TileSize * 2, TileSize, "🧱", true));
        AddWall(new(-TileSize, 0, TileSize, WorldHeight, "🧱", true));
        AddWall(new(WorldWidth, 0, TileSize, WorldHeight, "🧱", true));

        // Random obstacles (deterministic seed for consistency)
        var cols = WorldWidth / TileSize;
        var rows = WorldHeight / TileSize;
        var (ex, ey, ew, eh, _) = Extraction;

        for (var r = 2; r < rows - 2; r++)
        for (var c = 2; c < cols - 2; c++)
        {
            if (c * TileSize > ex - 100 && r * TileSize < ey + eh + 100) continue;
            if (Hypot(c * TileSize - 400, r * TileSize - (WorldHeight - 400)) < 300) continue;

            var roll = _rng.NextDouble();
            if (roll < 0.12)
                AddWall(new(c * TileSize, r * TileSize, TileSize, TileSize, "🧱", true));
            else if (roll < 0.20)
                AddWall(new(c * TileSize, r * TileSize, TileSize, TileSize, "🌲", true));
        }

        // Spawn bots
        for (int i = 0; i < 16; i++)
        {
            var bx = 300f + _rng.NextSingle() * (WorldWidth - 600);
            var by = 300f + _rng.NextSingle() * (WorldHeight - 600);
            var type = i == 0 ? "boss" : (_rng.NextDouble() < 0.5 ? "melee" : "ranged");
            var bot = new BotState(bx, by, type);
            _bots.Add(bot);
            _botHash.Insert(bot, bx, by);
        }

        // Spawn loot
        for (int i = 0; i < 20; i++)
        {
            var lx = 200f + _rng.NextSingle() * (WorldWidth - 400f);
            var ly = 200f + _rng.NextSingle() * (WorldHeight - 400f);
            var type = _rng.NextDouble() < 0.4 ? "cash" : (_rng.NextDouble() < 0.7 ? "box" : "gem");
            _loots.Add(new LootState(lx, ly, type));
        }
    }

    private void AddWall(WallData wall)
    {
        _walls.Add(wall);
        _wallHash.Insert(wall, wall.X + wall.W / 2f, wall.Y + wall.H / 2f);
    }

    // ---- Player movement with speedhack detection ----
    public (float newX, float newY, float spread) ProcessPlayerMovement(
        PlayerSession player, float dt,
        bool w, bool a, bool s, bool d, bool sprint)
    {
        float moveX = (d ? 1 : 0) - (a ? 1 : 0);
        float moveY = (s ? 1 : 0) - (w ? 1 : 0);
        float moveLen = MathF.Sqrt(moveX * moveX + moveY * moveY);

        player.IsSprinting = sprint && moveLen > 0 && player.Stamina > 0;
        var speed = player.BaseSpeed;

        if (player.IsSprinting)
        {
            speed *= player.SprintMultiplier;
            player.Stamina = MathF.Max(0, player.Stamina - dt * 35f);
        }
        else
        {
            var regenRate = moveLen > 0 ? 15f : 35f;
            player.Stamina = MathF.Min(player.MaxStamina, player.Stamina + dt * regenRate);
        }

        // Spread
        if (player.IsSprinting) player.Spread = 0.16f;
        else if (moveLen > 0) player.Spread = 0.08f;
        else player.Spread = 0.02f;

        if (moveLen > 0)
        {
            var normX = moveX / moveLen;
            var normY = moveY / moveLen;
            var vx = normX * speed * dt;
            var vy = normY * speed * dt;

            // Axis-separated AABB collision
            var half = player.Size * 0.4f;
            var boxX = new Rect(player.X + vx - half, player.Y - half, player.Size * 0.8f, player.Size * 0.8f);
            var collidesX = false;
            foreach (var wall in _wallHash.Query(player.X + vx, player.Y, player.Size))
            {
                if (wall.Emoji == "🧱" && Aabb(boxX, wall)) { collidesX = true; break; }
            }
            if (!collidesX) player.X += vx;

            var boxY = new Rect(player.X - half, player.Y + vy - half, player.Size * 0.8f, player.Size * 0.8f);
            var collidesY = false;
            foreach (var wall in _wallHash.Query(player.X, player.Y + vy, player.Size))
            {
                if (wall.Emoji == "🧱" && Aabb(boxY, wall)) { collidesY = true; break; }
            }
            if (!collidesY) player.Y += vy;

            // Clamp to world
            player.X = Math.Clamp(player.X, player.Size / 2, WorldWidth - player.Size / 2);
            player.Y = Math.Clamp(player.Y, player.Size / 2, WorldHeight - player.Size / 2);
        }

        return (player.X, player.Y, player.Spread);
    }

    // ---- Shooting (authoritative hitscan) ----
    public (bool hit, string? targetId, float hitX, float hitY) ProcessShot(
        float originX, float originY, float angle, float spread, PlayerSession shooter)
    {
        if (shooter.Gun.CurrentAmmo <= 0) return (false, null, 0, 0);

        shooter.Gun.CurrentAmmo--;
        shooter.Gun.Cooldown = shooter.Gun.FireRate;

        // Apply spread
        var finalAngle = angle + ((float)_rng.NextDouble() - 0.5f) * spread;
        var dirX = MathF.Cos(finalAngle);
        var dirY = MathF.Sin(finalAngle);
        const float maxRange = 1200f;

        // Raycast: check walls then bots
        float minT = maxRange;
        string? hitTargetId = null;

        // Check walls
        foreach (var wall in _walls)
        {
            if (wall.Emoji == "🌲") continue;
            var t = RayBoxIntersect(originX, originY, dirX, dirY,
                wall.X, wall.Y, wall.W, wall.H);
            if (t > 0 && t < minT) { minT = t; hitTargetId = null; }
        }

        // Check bots
        foreach (var bot in _bots)
        {
            if (bot.Hp <= 0) continue;
            var t = RayBoxIntersect(originX, originY, dirX, dirY,
                bot.X - bot.Size / 2, bot.Y - bot.Size / 2, bot.Size, bot.Size);
            if (t > 0 && t < minT) { minT = t; hitTargetId = bot.Id; }
        }

        var hitX = originX + dirX * minT;
        var hitY = originY + dirY * minT;

        if (hitTargetId != null)
        {
            var bot = _bots.First(b => b.Id == hitTargetId);
            var isHeadshot = _rng.NextDouble() < 0.25;
            var dmg = isHeadshot ? shooter.Gun.Damage * 2 : shooter.Gun.Damage;
            bot.Hp -= dmg;
            bot.State = "aggro";
            bot.TargetX = shooter.X;
            bot.TargetY = shooter.Y;

            if (bot.Hp <= 0)
            {
                // Drop loot at bot position
                var lootType = _rng.NextDouble() < 0.5 ? "cash" : "gem";
                _loots.Add(new LootState(bot.X, bot.Y, lootType));
            }
        }

        return (true, hitTargetId, hitX, hitY);
    }

    // ---- Bot AI update (tick-throttled) ----
    public List<Messages.SoundEvent> UpdateBots(float dt, List<PlayerSession> players)
    {
        var sounds = new List<Messages.SoundEvent>();
        _botHash.Clear();

        foreach (var bot in _bots)
        {
            if (bot.Hp <= 0) continue;
            _botHash.Insert(bot, bot.X, bot.Y);

            // Find nearest player
            PlayerSession? nearestPlayer = null;
            var nearestDist = float.MaxValue;
            foreach (var p in players)
            {
                var dist = Hypot(p.X - bot.X, p.Y - bot.Y);
                if (dist < nearestDist) { nearestDist = dist; nearestPlayer = p; }
            }
            if (nearestPlayer == null) continue;

            // FSM: Sensory
            if (nearestDist < BotViewRange && HasLineOfSight(bot.X, bot.Y, nearestPlayer.X, nearestPlayer.Y))
            {
                bot.State = "aggro";
                bot.TargetX = nearestPlayer.X;
                bot.TargetY = nearestPlayer.Y;
            }

            // Patrol
            if (bot.State == "patrol")
            {
                bot.PatrolTimer -= dt;
                if (bot.PatrolTimer <= 0)
                {
                    bot.TargetX = bot.X + ((float)_rng.NextDouble() - 0.5f) * 400f;
                    bot.TargetY = bot.Y + ((float)_rng.NextDouble() - 0.5f) * 400f;
                    bot.PatrolTimer = 3f + (float)_rng.NextDouble() * 4f;
                }
            }

            // Movement
            var moveDist = Hypot(bot.TargetX - bot.X, bot.TargetY - bot.Y);
            if (moveDist > 30)
            {
                var moveAngle = MathF.Atan2(bot.TargetY - bot.Y, bot.TargetX - bot.X);
                var nx = bot.X + MathF.Cos(moveAngle) * bot.Speed * dt;
                var ny = bot.Y + MathF.Sin(moveAngle) * bot.Speed * dt;
                var collides = false;
                foreach (var wall in _wallHash.Query(nx, ny, bot.Size))
                {
                    if (wall.Emoji == "🧱" && Aabb(new(nx - bot.Size / 2, ny - bot.Size / 2, bot.Size, bot.Size), wall))
                    { collides = true; break; }
                }
                if (!collides) { bot.X = nx; bot.Y = ny; }
                else { bot.TargetX = bot.X + ((float)_rng.NextDouble() - 0.5f) * 200f; bot.TargetY = bot.Y + ((float)_rng.NextDouble() - 0.5f) * 200f; }
            }

            // Combat
            bot.FireCooldown -= dt;
            if (bot.State == "aggro" && nearestDist < (bot.Type == "melee" ? BotMeleeRange : BotAggroRange) && bot.FireCooldown <= 0)
            {
                if (HasLineOfSight(bot.X, bot.Y, nearestPlayer.X, nearestPlayer.Y))
                {
                    bot.FireCooldown = bot.Type == "melee" ? 1f : 0.6f;
                    var baseDmg = bot.Type == "melee" ? 30f : 20f;
                    var pen = bot.Type == "melee" ? 15f : 25f;

                    if (nearestPlayer.Armor > 0)
                    {
                        if (pen >= nearestPlayer.ArmorClass * 10)
                        {
                            nearestPlayer.Hp -= baseDmg * 0.8f;
                            nearestPlayer.Armor -= baseDmg * 0.3f;
                        }
                        else
                        {
                            nearestPlayer.Armor -= baseDmg * 0.6f;
                            nearestPlayer.Hp -= baseDmg * 0.15f;
                        }
                    }
                    else nearestPlayer.Hp -= baseDmg;

                    nearestPlayer.Armor = MathF.Max(0, nearestPlayer.Armor);
                    nearestPlayer.Hp = MathF.Max(0, nearestPlayer.Hp);

                    sounds.Add(new(bot.X, bot.Y, 500f, "gunshot"));
                }
            }
        }

        return sounds;
    }

    public void HandleInteract(PlayerSession player)
    {
        for (var i = _loots.Count - 1; i >= 0; i--)
        {
            var loot = _loots[i];
            var dist = Hypot(player.X - loot.X, player.Y - loot.Y);
            if (dist < 60 && player.Inventory.Count < player.MaxSlots)
            {
                player.Inventory.Add(new(loot.Id, loot.Type, loot.Emoji, loot.Name));
                _loots.RemoveAt(i);
                break;
            }
        }
    }

    public bool CheckExtraction(PlayerSession player)
    {
        var (ex, ey, ew, eh, _) = Extraction;
        var half = player.Size * 0.4f;
        return Aabb(new Rect(player.X - half, player.Y - half, player.Size * 0.8f, player.Size * 0.8f),
                     new Rect(ex, ey, ew, eh));
    }

    // ---- Collision helpers ----
    private static bool Aabb(Rect a, WallData b) =>
        a.X < b.X + b.W && a.X + a.W > b.X && a.Y < b.Y + b.H && a.Y + a.H > b.Y;

    private static bool Aabb(Rect a, Rect b) =>
        a.X < b.X + b.W && a.X + a.W > b.X && a.Y < b.Y + b.H && a.Y + a.H > b.Y;

    private static float Hypot(float x, float y) => MathF.Sqrt(x * x + y * y);

    private bool HasLineOfSight(float x1, float y1, float x2, float y2)
    {
        var dist = Hypot(x2 - x1, y2 - y1);
        var dirX = (x2 - x1) / dist;
        var dirY = (y2 - y1) / dist;

        foreach (var wall in _wallHash.Query((x1 + x2) / 2, (y1 + y2) / 2, dist / 2))
        {
            if (!wall.BlockingLoS) continue;
            var t = RayBoxIntersect(x1, y1, dirX, dirY, wall.X, wall.Y, wall.W, wall.H);
            if (t > 0 && t < dist) return false;
        }
        return true;
    }

    private static float RayBoxIntersect(float ox, float oy, float dx, float dy,
        float bx, float by, float bw, float bh)
    {
        var invDx = 1f / (dx == 0 ? 0.00001f : dx);
        var invDy = 1f / (dy == 0 ? 0.00001f : dy);
        var t1 = (bx - ox) * invDx;
        var t2 = (bx + bw - ox) * invDx;
        var t3 = (by - oy) * invDy;
        var t4 = (by + bh - oy) * invDy;
        var tmin = MathF.Max(MathF.Min(t1, t2), MathF.Min(t3, t4));
        var tmax = MathF.Min(MathF.Max(t1, t2), MathF.Max(t3, t4));
        if (tmax < 0 || tmin > tmax) return -1f;
        return tmin < 0 ? tmax : tmin;
    }

    // ---- Internal types ----
    public record struct Rect(float X, float Y, float W, float H);

    public class WallData
    {
        public float X, Y, W, H;
        public string Emoji;
        public bool BlockingLoS;
        public WallData(float x, float y, float w, float h, string emoji, bool blockingLoS)
        { X = x; Y = y; W = w; H = h; Emoji = emoji; BlockingLoS = blockingLoS; }
    }

    public class BotState
    {
        public string Id { get; } = Guid.NewGuid().ToString("N")[..8];
        public float X, Y;
        public float Size = 48f;
        public string Type;
        public string Emoji;
        public float Hp, MaxHp;
        public float Speed;
        public string State = "patrol";
        public float TargetX, TargetY;
        public float PatrolTimer;
        public float FireCooldown;

        public BotState(float x, float y, string type)
        {
            X = x; Y = y; Type = type;
            Emoji = type == "melee" ? "🧟" : (type == "boss" ? "👹" : "👮");
            MaxHp = type == "boss" ? 300f : 80f; Hp = MaxHp;
            Speed = type == "melee" ? 180f : 140f;
            TargetX = x + (Random.Shared.NextSingle() - 0.5f) * 300f;
            TargetY = y + (Random.Shared.NextSingle() - 0.5f) * 300f;
        }
    }

    public class LootState
    {
        public string Id { get; } = Guid.NewGuid().ToString("N")[..8];
        public float X, Y;
        public float Size = 36f;
        public string Type;
        public string Emoji;
        public string Name;

        public LootState(float x, float y, string type)
        {
            X = x; Y = y; Type = type;
            Emoji = type == "cash" ? "💵" : type == "gem" ? "💎" : type == "box" ? "📦" : "🎒";
            Name = type == "cash" ? "大捆现金" : type == "gem" ? "高价值蓝钻" : type == "box" ? "军用物资箱" : "遗落背包";
        }
    }
}
