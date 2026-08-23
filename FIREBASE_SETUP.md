# Wiring 3 Unity games into one Firebase + this scoreboard

There are **two different configs** and mixing them up is the usual stumbling
block:

| Config | Generated as | Lives in | Used by |
| --- | --- | --- | --- |
| **Web config** | a JS object you copy from the console | [firebase-config.js](firebase-config.js) | the scoreboard (reads) |
| **Unity config** | `google-services.json` you download | each game's `Assets/` | the games (write) |

Both come from **one Firebase project**. One project, four registered apps:
three Unity games + one web app.

---

## 1. Create the project and register the apps

1. <https://console.firebase.google.com> → **Add project** (e.g. `arcade-network`).
   Do this **once** — do not make a project per game, or the scores can't be
   combined.
2. **Build → Firestore Database → Create database**. Pick a region close to your
   players; start in production mode (rules come in step 5).
3. **Project settings (gear) → General → Your apps**. Register:

   | App | Button | Key field |
   | --- | --- | --- |
   | Scoreboard | **Web** `</>` | nickname `scoreboard` |
   | Game 1 | **Android** / **iOS** | package name `com.you.neonrunner` |
   | Game 2 | **Android** / **iOS** | package name `com.you.starblaster` |
   | Game 3 | **Android** / **iOS** | package name `com.you.blockpuzzle` |

   The package name must match **Player Settings → Other Settings → Package
   Name** in that Unity project exactly, or the SDK refuses to initialise.
   Building for both Android and iOS? Register both per game (6 app entries).

---

## 2. Generate the **web** config (the scoreboard's)

**Project settings → General → Your apps → the web app → SDK setup and
configuration → Config.**

You get exactly this, filled in:

```js
const firebaseConfig = {
  apiKey: "AIzaSyD-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  authDomain: "arcade-network.firebaseapp.com",
  projectId: "arcade-network",
  storageBucket: "arcade-network.appspot.com",
  messagingSenderId: "418322091234",
  appId: "1:418322091234:web:9a1f0c2e7b3d4a5e6f7a8b",
};
```

Paste those values into `firebaseConfig` in
[firebase-config.js](firebase-config.js). That's the whole "generation" step —
it's copy-out, not a build tool.

> This config is **safe to ship publicly**. It names the project; it grants
> nothing. Anyone can read your `apiKey` from any Firebase web app. Access is
> decided by security rules (step 5). Don't confuse it with a *service account
> key*, which is secret and never belongs in a client.

Then set the rest of that file to match your games:

```js
export const BACKEND = "firestore";
export const SCHEMA  = "multi-game";
export const PLAYERS_PATH = "scores";

export const GAMES = [
  { id: "neon-runner",  label: "RUNNER"  },
  { id: "star-blaster", label: "BLASTER" },
  { id: "block-puzzle", label: "PUZZLE"  },
];

export const SCORE_MODE = "total";  // or "best"
```

`GAMES[].id` must match the `gameId` each Unity build writes — that string is
the contract between the games and the board.

---

## 3. Generate the **Unity** config (each game's)

Per game, in **Project settings → Your apps → that Android/iOS app**:

- Android → **google-services.json** → download → drop in that project's
  `Assets/` folder (root, not a subfolder).
- iOS → **GoogleService-Info.plist** → same place.

Then in each Unity project:

1. Download the **Firebase Unity SDK**, import `FirebaseFirestore.unitypackage`
   (it pulls in `FirebaseApp`). Let External Dependency Manager resolve.
2. Add [unity/LeaderboardClient.cs](unity/LeaderboardClient.cs) to the project.
3. Put the component on a bootstrap GameObject and set **gameId** to that
   game's id — `neon-runner`, `star-blaster`, or `block-puzzle`.

All three games share the identical script. Only `gameId` differs.

### Generating the config in code instead

`google-services.json` isn't picked up for standalone desktop builds, and it's
awkward in the Editor. `LeaderboardClient` can build the same options by hand —
tick **useManualConfig** and fill three fields. They map to the web config like
this:

| `AppOptions` | Web config key | `google-services.json` |
| --- | --- | --- |
| `ApiKey` | `apiKey` | `client[0].api_key[0].current_key` |
| `AppId` | `appId` | `client[0].client_info.mobilesdk_app_id` |
| `ProjectId` | `projectId` | `project_info.project_id` |
| `DatabaseUrl` | `databaseURL` | `project_info.firebase_url` (RTDB only) |

```csharp
FirebaseApp.Create(new AppOptions {
    ApiKey    = "AIzaSy...",
    AppId     = "1:418322091234:android:...",   // per-game, not the web appId
    ProjectId = "arcade-network",
});
```

`AppId` is **per app**, so each game uses its own. `ProjectId` and `ApiKey` are
shared across the project.

---

## 4. Make the player the *same* player in all three games

This is the part that actually decides whether one combined board is possible.
The scoreboard groups rows by `playerId` — so all three builds must produce the
**same** `playerId` for the same human.

| Approach | Same id across games? | Cost |
| --- | --- | --- |
| `SystemInfo.deviceUniqueIdentifier` | Yes on one device, no across devices | free |
| `PlayerPrefs` random guid | **No** — PlayerPrefs is per-app | free |
| Join code the player types in each game | Yes | one input field |
| Firebase Auth, Google / email sign-in | Yes, and across devices | a sign-in screen |
| Firebase Auth, **anonymous** | **No** — new uid per app install | free |

Anonymous auth is the trap: it mints a fresh uid for each game, so a player
shows up as three unrelated rows.

Simplest workable option — a join code:

```csharp
PlayerIdentity.UseJoinCode("pixelpete");     // same string in all 3 games
LeaderboardClient.Instance.SubmitScore(finalScore);
```

Proper option — Google/email sign-in. The uid **is** shared by every app in one
Firebase project, so the same account yields the same `playerId` everywhere:

```csharp
var user = await FirebaseAuth.DefaultInstance.SignInWithCredentialAsync(cred);
PlayerIdentity.UseAuthUid(user.UserId, user.DisplayName);
```

---

## 5. Security rules

The board only reads. Let clients read, and let a player write only their own
row — otherwise anyone can post any score for anyone.

Signed-in players (Auth uid as playerId):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /scores/{docId} {
      allow read: if true;
      allow write: if request.auth != null
                   && request.resource.data.playerId == request.auth.uid
                   && docId == request.auth.uid + '__' + request.resource.data.gameId
                   && request.resource.data.score is int
                   && request.resource.data.score >= 0;
    }
  }
}
```

If you go the join-code route there's no auth to check, so a client can write
any row. For a class project that's usually fine:

```
match /scores/{docId} {
  allow read: if true;
  allow write: if request.resource.data.score is int
               && request.resource.data.score >= 0
               && request.resource.data.score < 10000000;
}
```

If scores need to be trustworthy, don't let clients write at all — have the game
call a Cloud Function that validates the run and writes with the Admin SDK.

---

## 6. Check it works

1. `python -m http.server 5180` → open <http://localhost:5180>. The chip should
   read **LIVE** (green) instead of DEMO MODE.
2. In the Firestore console, add a document by hand to `scores`:

   | Doc id | Fields |
   | --- | --- |
   | `testguy__neon-runner` | `playerId` "testguy", `name` "TESTGUY", `gameId` "neon-runner", `score` 5000 (number) |

   The row appears on the board within a second, without a refresh.
3. Edit `score` to `90000` → the row slides up the table.
4. Add `testguy__star-blaster` → on **ALL GAMES** the totals combine and the tag
   reads `2 GAMES`; on the **BLASTER** tab only the blaster score shows.
5. Run a game, trigger game over, confirm a document appears.

**Chip still says DEMO MODE?** `apiKey` is empty. **Says OFFLINE/ERROR?** Open
the console — `permission-denied` means rules, `not-found` means the Firestore
database wasn't created.

---

## Scale note

The board subscribes to the whole `scores` collection, which is right for a jam
or a class demo (hundreds of rows). Past a few thousand players every listener
downloads every row. At that point switch the query to
`orderBy("score", "desc")` + `limit(100)` in [data.js](data.js) — you lose the
long unranked tail but reads stay flat.
