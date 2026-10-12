// The connect screen, shown when this browser session has no GitHub token.
// Same flow as TCM Tracker: "I have an ID" checks that the ID's folder exists
// (your TCM Tracker ID works as-is), "I'm new" creates a typo-safe ID. The ID
// sits in the username field and the token in the password field, so Apple
// Passwords can save and fill both together.

import { getConfig, setConfig, getUserId, testConnection, userFolderExists, createUserFolder, adoptUserId, setToken } from "./sync.js";
import { generateUserId, normalizeUserId, checkUserId } from "./ids.js";
import { esc } from "./ui.js";

const ERRORS = {
  "bad-token": "That token isn't valid or has expired. Make a new one on GitHub and paste it here.",
  "repo-not-found-or-no-access": "Can't open the data repo with this token. Check the token has access to personal_tcm_daily_log.",
  offline: "Can't reach GitHub right now. Check your connection, or continue offline.",
  "no-such-id": "No data found for this ID. Check the spelling, or choose \"I'm new\".",
  "bad-id": "That ID doesn't look right. Check each character and try again.",
  "unsynced-other-user": "This phone has unsynced changes for another ID. Connect with that ID first so they upload.",
  taken: "That ID is already taken, so a new one has been made.",
};
const errorText = (code) => ERRORS[code] || `Couldn't connect (${code}).`;

const OFFLINE_KEY = "soh_offline_session";
export function offlineThisSession() {
  try { return sessionStorage.getItem(OFFLINE_KEY) === "1"; } catch (e) { return false; }
}

// Resolves true once connected, false if the person chose to stay offline.
export function openConnect({ allowOffline = true } = {}) {
  return new Promise(async (resolve) => {
    const cfg = await getConfig();
    const storedId = await getUserId();
    let mode = "existing";
    let newId = generateUserId();

    const overlay = document.createElement("div");
    overlay.className = "connect";
    document.body.appendChild(overlay);

    const finish = (result) => { overlay.remove(); resolve(result); };

    function render(error = "") {
      overlay.innerHTML = `
        <div class="screen" role="dialog" aria-modal="true" aria-labelledby="connectTitle">
          <h1 id="connectTitle">Home stock</h1>
          <p class="lead">Your list saves on this phone and syncs to your private GitHub data repo, the same one TCM Tracker uses. Use the same user ID on another phone to share one list.</p>

          <div class="seg" role="group" aria-label="Account" style="margin-top:24px">
            <button type="button" data-mode="existing" aria-pressed="${mode === "existing"}">I have an ID</button>
            <button type="button" data-mode="new" aria-pressed="${mode === "new"}">I'm new</button>
          </div>

          <form id="connectForm" autocomplete="on" novalidate>
            ${mode === "existing" ? `
              <div class="field">
                <label for="connectId">User ID</label>
                <input type="text" id="connectId" name="username" autocomplete="username" autocapitalize="characters"
                  autocorrect="off" spellcheck="false" placeholder="Your TCM Tracker ID" value="${esc(storedId || "")}" required>
                <p class="hint">The ID you already use in TCM Tracker.</p>
              </div>
            ` : `
              <div class="field">
                <label for="connectId">Your new ID</label>
                <div style="display:flex;gap:8px">
                  <input type="text" id="connectId" name="username" autocomplete="username" readonly value="${esc(newId)}">
                  <button type="button" class="btn" data-act="regen">New one</button>
                </div>
                <p class="hint">Write this down. Enter it on another phone to see the same list.</p>
              </div>
            `}
            <div class="field">
              <label for="connectToken">GitHub token</label>
              <input type="password" id="connectToken" name="password" autocomplete="current-password" required>
              <p class="hint">Kept for this session only, never saved on the phone. Let Apple Passwords save the ID and token to fill them in next time.</p>
            </div>

            <details>
              <summary>Advanced</summary>
              <div class="field"><label for="cOwner">GitHub owner</label><input type="text" id="cOwner" value="${esc(cfg.gh_owner)}" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
              <div class="field"><label for="cRepo">Data repository</label><input type="text" id="cRepo" value="${esc(cfg.gh_repo)}" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
              <div class="field"><label for="cBranch">Branch</label><input type="text" id="cBranch" value="${esc(cfg.gh_branch)}" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
              <div class="field"><label for="cPrefix">Folder</label><input type="text" id="cPrefix" value="${esc(cfg.gh_path_prefix)}" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
            </details>

            <p class="error" role="alert" ${error ? "" : "hidden"}>${esc(error)}</p>
            <div class="btn-row">
              <button type="submit" class="btn primary" id="connectSubmit">${mode === "existing" ? "Connect" : "Create and connect"}</button>
              <button type="button" class="btn quiet" data-act="${allowOffline ? "offline" : "cancel"}">${allowOffline ? "Continue offline" : "Cancel"}</button>
            </div>
          </form>
        </div>`;
    }

    overlay.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-mode]");
      if (tab) { mode = tab.dataset.mode; render(); return; }
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "regen") { newId = generateUserId(); overlay.querySelector("#connectId").value = newId; }
      if (act === "offline") {
        try { sessionStorage.setItem(OFFLINE_KEY, "1"); } catch (err) { /* ignore */ }
        finish(false);
      }
      if (act === "cancel") finish(false);
    });

    overlay.addEventListener("submit", async (e) => {
      e.preventDefault();
      const $ = (sel) => overlay.querySelector(sel);
      const submit = $("#connectSubmit");
      const errEl = $(".error");
      const show = (msg) => { errEl.textContent = msg; errEl.hidden = !msg; };
      const id = normalizeUserId($("#connectId").value);
      if (!id || !checkUserId(id)) { show(errorText("bad-id")); return; }
      const token = $("#connectToken").value.trim();
      if (!token) { show("Paste your GitHub token to connect."); $("#connectToken").focus(); return; }

      submit.disabled = true;
      submit.textContent = "Connecting…";
      show("");
      try {
        await setConfig({
          gh_owner: $("#cOwner").value.trim(), gh_repo: $("#cRepo").value.trim(),
          gh_branch: $("#cBranch").value.trim(), gh_path_prefix: $("#cPrefix").value.trim(), gh_token: token,
        });
        const cfg2 = await getConfig();
        const test = await testConnection(cfg2);
        if (!test.ok) throw new Error(test.error);
        if (mode === "existing") {
          if (!(await userFolderExists(cfg2, id))) throw new Error("no-such-id");
        } else {
          const created = await createUserFolder(cfg2, id);
          if (!created.ok) {
            if (created.error === "taken") { newId = generateUserId(); $("#connectId").value = newId; }
            throw new Error(created.error);
          }
        }
        const adopted = await adoptUserId(id);
        if (!adopted.ok) throw new Error(adopted.error);
        try { sessionStorage.removeItem(OFFLINE_KEY); } catch (err) { /* ignore */ }
        finish(true);
      } catch (err) {
        setToken("");
        const code = String(err.message || err);
        submit.disabled = false;
        submit.textContent = mode === "existing" ? "Connect" : "Create and connect";
        show(errorText(/Failed to fetch|Load failed/.test(code) ? "offline" : code));
      }
    });

    render();
    overlay.querySelector(storedId ? "#connectToken" : "#connectId")?.focus({ preventScroll: true });
  });
}
