// ==============================================================
//  LeaderboardClient.cs
//  Drop this into all three Unity games. The ONLY thing that
//  differs per game is `gameId` in the inspector.
//
//  Setup per project:
//    1. Import FirebaseFirestore.unitypackage (Firebase Unity SDK).
//    2. Put that game's google-services.json in Assets/.
//    3. Add this component to a bootstrap GameObject, set gameId.
//    4. Call LeaderboardClient.Instance.SubmitScore(finalScore) on
//       game over.
//
//  Writes one document per (player, game):
//    scores/{playerId}__{gameId} = { playerId, name, gameId, score }
//  which is exactly what the web scoreboard reads.
// ==============================================================

using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Firebase;
using Firebase.Extensions;
using Firebase.Firestore;
using UnityEngine;

public class LeaderboardClient : MonoBehaviour
{
    public static LeaderboardClient Instance { get; private set; }

    [Header("Identity of THIS game")]
    [Tooltip("Must match an id in the scoreboard's GAMES list: " +
             "neon-runner / star-blaster / block-puzzle")]
    [SerializeField] private string gameId = "neon-runner";

    [Header("Storage")]
    [SerializeField] private string collectionName = "scores";
    [Tooltip("Only overwrite the stored score when the new one is higher.")]
    [SerializeField] private bool keepPersonalBest = true;

    [Header("Desktop / editor fallback")]
    [Tooltip("Use the hand-written config below instead of google-services.json. " +
             "Handy for Editor play mode and standalone builds.")]
    [SerializeField] private bool useManualConfig = false;
    [SerializeField] private string apiKey    = "";
    [SerializeField] private string appId     = "";
    [SerializeField] private string projectId = "";

    private FirebaseFirestore _db;
    private bool _ready;

    public bool IsReady => _ready;
    public string GameId => gameId;

    // ── lifecycle ─────────────────────────────────────────────
    private void Awake()
    {
        if (Instance != null && Instance != this) { Destroy(gameObject); return; }
        Instance = this;
        DontDestroyOnLoad(gameObject);
        Initialise();
    }

    private void Initialise()
    {
        FirebaseApp.CheckAndFixDependenciesAsync().ContinueWithOnMainThread(task =>
        {
            if (task.Result != DependencyStatus.Available)
            {
                Debug.LogError($"[Leaderboard] Firebase unavailable: {task.Result}");
                return;
            }

            // Normally the SDK reads google-services.json automatically.
            // useManualConfig builds the same options in code instead.
            if (useManualConfig && FirebaseApp.DefaultInstance == null)
            {
                FirebaseApp.Create(new AppOptions
                {
                    ApiKey    = apiKey,
                    AppId     = appId,
                    ProjectId = projectId,
                });
            }

            _db = FirebaseFirestore.DefaultInstance;
            _ready = true;
            Debug.Log($"[Leaderboard] ready — game '{gameId}', player '{PlayerIdentity.PlayerId}'");
        });
    }

    // ── the one call your games make ──────────────────────────
    /// <summary>Publish a run's score. Safe to call every game over.</summary>
    public Task SubmitScore(long score) =>
        SubmitScore(PlayerIdentity.PlayerId, PlayerIdentity.PlayerName, score);

    public async Task SubmitScore(string playerId, string playerName, long score)
    {
        if (!_ready)
        {
            Debug.LogWarning("[Leaderboard] not ready yet — score dropped.");
            return;
        }
        if (string.IsNullOrEmpty(playerId))
        {
            Debug.LogWarning("[Leaderboard] no player id — score dropped.");
            return;
        }

        // Deterministic id: this game can only ever touch its own row,
        // so three games writing at once never clobber each other.
        DocumentReference doc = _db
            .Collection(collectionName)
            .Document($"{playerId}__{gameId}");

        var payload = new Dictionary<string, object>
        {
            { "playerId",  playerId },
            { "name",      playerName },
            { "gameId",    gameId },
            { "score",     score },
            { "updatedAt", FieldValue.ServerTimestamp },
        };

        try
        {
            if (!keepPersonalBest)
            {
                await doc.SetAsync(payload, SetOptions.MergeAll);
                return;
            }

            await _db.RunTransactionAsync(async transaction =>
            {
                DocumentSnapshot snap = await transaction.GetSnapshotAsync(doc);

                long best = 0;
                if (snap.Exists && snap.ContainsField("score"))
                    best = snap.GetValue<long>("score");

                if (snap.Exists && score <= best) return false;   // not a PB

                transaction.Set(doc, payload, SetOptions.MergeAll);
                return true;
            });
        }
        catch (Exception e)
        {
            Debug.LogError($"[Leaderboard] submit failed: {e.Message}");
        }
    }
}

// ==============================================================
//  PlayerIdentity
//  The scoreboard groups the three games by playerId, so all three
//  builds must produce the SAME id for the same human.
//
//  PlayerPrefs alone is per-device AND per-game, so it will NOT link
//  a player across games. Pick one of these:
//    A) a join code the player types once in each game  (no backend)
//    B) Firebase Auth with Google / email sign-in — the uid is shared
//       across every app in the project (see FIREBASE_SETUP.md)
// ==============================================================
public static class PlayerIdentity
{
    private const string IdKey   = "leaderboard_player_id";
    private const string NameKey = "leaderboard_player_name";

    /// <summary>Stable id shared by all three games for this player.</summary>
    public static string PlayerId
    {
        get => PlayerPrefs.GetString(IdKey, "");
        private set { PlayerPrefs.SetString(IdKey, value); PlayerPrefs.Save(); }
    }

    public static string PlayerName
    {
        get => PlayerPrefs.GetString(NameKey, "PLAYER");
        set { PlayerPrefs.SetString(NameKey, value.ToUpperInvariant()); PlayerPrefs.Save(); }
    }

    /// <summary>
    /// Option A — the player types the same code in all three games.
    /// Normalised so "Pixel Pete" and "pixelpete" land on one row.
    /// </summary>
    public static void UseJoinCode(string code, string displayName = null)
    {
        string slug = (code ?? "").Trim().ToLowerInvariant().Replace(" ", "-");
        if (string.IsNullOrEmpty(slug)) return;

        PlayerId = slug;
        PlayerName = string.IsNullOrEmpty(displayName) ? code : displayName;
    }

    /// <summary>Option B — call with the uid from Firebase Auth sign-in.</summary>
    public static void UseAuthUid(string uid, string displayName)
    {
        if (string.IsNullOrEmpty(uid)) return;
        PlayerId = uid;
        if (!string.IsNullOrEmpty(displayName)) PlayerName = displayName;
    }
}
