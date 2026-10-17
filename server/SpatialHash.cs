// SpatialHash.cs - O(1) grid-based spatial partitioning
namespace EmojiDelta.Server;

public class SpatialHash<T> where T : class
{
    public record struct BucketKey(int X, int Y);

    private readonly int _cellSize;
    private readonly Dictionary<BucketKey, List<T>> _buckets = new();

    public SpatialHash(int cellSize) { _cellSize = cellSize; }

    public void Clear() => _buckets.Clear();

    public BucketKey Key(float x, float y) =>
        new((int)MathF.Floor(x / _cellSize), (int)MathF.Floor(y / _cellSize));

    public void Insert(T item, float x, float y)
    {
        var key = Key(x, y);
        if (!_buckets.TryGetValue(key, out var list))
            _buckets[key] = list = new List<T>(16);
        list.Add(item);
    }

    public IEnumerable<T> Query(float x, float y, float radius = 0)
    {
        var cx = (int)MathF.Floor(x / _cellSize);
        var cy = (int)MathF.Floor(y / _cellSize);
        var range = (int)MathF.Ceiling(radius / _cellSize) + 1;

        for (var dx = -range; dx <= range; dx++)
        for (var dy = -range; dy <= range; dy++)
        {
            var key = new BucketKey(cx + dx, cy + dy);
            if (_buckets.TryGetValue(key, out var list))
            {
                foreach (var item in list)
                    yield return item;
            }
        }
    }

    public void Remove(T item, float x, float y)
    {
        var key = Key(x, y);
        if (_buckets.TryGetValue(key, out var list))
            list.Remove(item);
    }
}
