import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

const btnGoogle = document.getElementById("btn-google");
const spinner = document.getElementById("spinner");
const errorEl = document.getElementById("error");

let busy = false;

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = "block";
}

function hideError() {
  errorEl.style.display = "none";
  errorEl.textContent = "";
}

function setBusy(b) {
  busy = b;
  btnGoogle.disabled = b;
  spinner.classList.toggle("active", b);
  btnGoogle.querySelector("svg").style.display = b ? "none" : "block";
}

async function init() {
  try {
    const firebaseConfig = await window.electronAuth.getFirebaseConfig();
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    // If the page loaded as a result of an OAuth redirect, collect the result.
    setBusy(true);
    try {
      const result = await getRedirectResult(auth);
      if (result) {
        const idToken = await result.user.getIdToken();
        const email = result.user.email || "";
        window.electronAuth.sendToken(idToken, email);
        return;
      }
    } catch (redirectErr) {
      const ignoreable =
        !redirectErr.code ||
        redirectErr.code === "auth/no-auth-event" ||
        redirectErr.code === "auth/null-user";
      if (!ignoreable) {
        showError(redirectErr.message || "Login gagal.");
        window.electronAuth.sendError(redirectErr.message || "Login gagal");
        setBusy(false);
        return;
      }
    }
    setBusy(false);

    // Show button for fresh sign-in.
    btnGoogle.addEventListener("click", async () => {
      if (busy) return;
      hideError();
      setBusy(true);
      try {
        await signInWithRedirect(auth, provider);
        // Page navigates away; nothing more to do here.
      } catch (err) {
        showError(err.message || "Terjadi kesalahan.");
        window.electronAuth.sendError(err.message || "Login gagal");
        setBusy(false);
      }
    });
  } catch (err) {
    showError("Gagal memuat konfigurasi Firebase: " + (err.message || ""));
    window.electronAuth.sendError(err.message || "Config load failed");
  }
}

init();
