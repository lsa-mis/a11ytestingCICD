// Small amount of progressive-enhancement behaviour for the landing page.
// Everything here is optional: the page is fully usable if JavaScript fails.

// Keep the footer copyright year current.
const yearEl = document.getElementById("year");
if (yearEl) {
  yearEl.textContent = String(new Date().getFullYear());
}

// Accessible newsletter form handling.
const form = document.getElementById("newsletter") as HTMLFormElement | null;
const email = document.getElementById("email") as HTMLInputElement | null;
const statusEl = document.getElementById("form-status");

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!email || !statusEl) return;

  // Native constraint validation keeps the logic simple and standards-based.
  if (!email.value.trim() || !email.checkValidity()) {
    statusEl.dataset.state = "error";
    statusEl.textContent = "Please enter a valid email address.";
    // Move focus to the field so keyboard and screen-reader users can correct it.
    email.focus();
    return;
  }

  statusEl.dataset.state = "success";
  statusEl.textContent = `Thanks! We've sent your discount code to ${email.value.trim()}.`;
  form.reset();
});
