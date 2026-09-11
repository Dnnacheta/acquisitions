/* global document, window */
const reset = window.location.pathname === "/reset-password";
const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
window.history.replaceState(null, "", window.location.pathname);
const form = document.getElementById("account-form");
const button = document.getElementById("submit");
const status = document.getElementById("status");
const password = document.getElementById("password");
document.getElementById("heading").textContent = reset
  ? "Reset your password"
  : "Verify your email";
button.textContent = reset ? "Reset password" : "Verify email";
document.getElementById("password-field").hidden = !reset;
password.required = reset;
if (!token || !/^[a-f0-9]{64}$/.test(token)) {
  form.hidden = true;
  status.textContent =
    "This link is invalid. Request a new email and use its link.";
}
form.addEventListener("submit", async event => {
  event.preventDefault();
  button.disabled = true;
  try {
    const response = await fetch(
      `/api/auth/${reset ? "reset-password" : "verify-email"}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          ...(reset ? { password: password.value } : {}),
        }),
      },
    );
    const result = await response.json();
    status.textContent = result.message;
    if (response.ok) {
      form.hidden = true;
      password.value = "";
    }
  } catch {
    status.textContent = "Unable to connect. Please try again.";
  } finally {
    button.disabled = false;
  }
});
