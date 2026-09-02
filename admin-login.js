document.addEventListener("DOMContentLoaded", () => {

  const $ = id => document.getElementById(id);

  const form = $("adminLoginForm");
  const emailInput = $("adminEmail");
  const passwordInput = $("adminPassword");
  const passwordToggle = $("adminPasswordToggle");
  const loginButton = $("adminLoginBtn");
  const errorBox = $("adminLoginError");


  /* =========================================================
     ERROR MESSAGE
  ========================================================= */

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add("show");
  }


  function clearError() {
    errorBox.textContent = "";
    errorBox.classList.remove("show");
  }


  /* =========================================================
     SHOW / HIDE PASSWORD
  ========================================================= */

  if (passwordToggle) {

    passwordToggle.addEventListener("click", () => {

      const isPassword =
        passwordInput.type === "password";

      passwordInput.type =
        isPassword ? "text" : "password";

      passwordToggle.textContent =
        isPassword ? "Hide" : "Show";

    });

  }


  /* =========================================================
     ADMIN LOGIN
  ========================================================= */

  form.addEventListener("submit", async event => {

    event.preventDefault();

    clearError();

    const email = emailInput.value.trim();
    const password = passwordInput.value;


    if (!email) {

      showError("Please enter your admin email.");

      emailInput.focus();

      return;
    }


    if (!password) {

      showError("Please enter your password.");

      passwordInput.focus();

      return;
    }


    loginButton.disabled = true;
    loginButton.textContent = "Logging in...";


    try {

      const response = await fetch("/api/admin/login", {

        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        credentials: "same-origin",

        body: JSON.stringify({
          email,
          password
        })

      });


      const data = await response.json();


      if (!response.ok) {

        throw new Error(
          data.error || "Invalid admin email or password."
        );

      }


      /*
        Admin authentication was successful.
        The server creates the admin session.
      */

      window.location.href = "/admin.html";


    } catch (error) {

      console.error("ADMIN LOGIN ERROR:", error);

      showError(
        error.message ||
        "Unable to log in. Please try again."
      );

      loginButton.disabled = false;
      loginButton.textContent = "Log in";

    }

  });


  /* =========================================================
     SCREEN NAVIGATION
  ========================================================= */

  function showLoginScreen() {
    $("adminLoginForm").classList.remove("hidden");
    $("adminForgotForm").classList.add("hidden");
    $("adminResetForm").classList.add("hidden");
    clearError();
    clearForgotError();
    clearResetError();
  }

  function showForgotScreen() {
    $("adminLoginForm").classList.add("hidden");
    $("adminForgotForm").classList.remove("hidden");
    $("adminResetForm").classList.add("hidden");
    $("adminForgotEmail").value = emailInput.value || "";
    $("adminForgotEmail").focus();
    clearForgotError();
  }

  function showResetScreen() {
    $("adminLoginForm").classList.add("hidden");
    $("adminForgotForm").classList.add("hidden");
    $("adminResetForm").classList.remove("hidden");
    clearResetError();
  }


  /* =========================================================
     FORGOT PASSWORD
  ========================================================= */

  const forgotForm = $("adminForgotForm");
  const forgotEmailInput = $("adminForgotEmail");
  const forgotSubmitBtn = $("adminForgotSubmitBtn");
  const forgotErrorBox = $("adminForgotError");
  const backToLoginBtn = $("adminBackToLoginBtn");

  function clearForgotError() {
    forgotErrorBox.textContent = "";
    forgotErrorBox.classList.remove("show");
  }

  function showForgotError(message) {
    forgotErrorBox.textContent = message;
    forgotErrorBox.classList.add("show");
  }

  $("adminForgotBtn").addEventListener("click", showForgotScreen);

  backToLoginBtn.addEventListener("click", showLoginScreen);

  forgotForm.addEventListener("submit", async event => {
    event.preventDefault();
    clearForgotError();

    const email = forgotEmailInput.value.trim();

    if (!email) {
      showForgotError("Please enter your admin email.");
      forgotEmailInput.focus();
      return;
    }

    forgotSubmitBtn.disabled = true;
    forgotSubmitBtn.textContent = "Sending...";

    try {
      const response = await fetch("/api/admin/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to process request.");
      }

      alert(data.message || "If an account exists for this email, a password reset link has been sent.");
      showLoginScreen();

    } catch (error) {
      showForgotError(error.message || "Unable to send reset link.");
      forgotSubmitBtn.disabled = false;
      forgotSubmitBtn.textContent = "Send reset link";
    }
  });


  /* =========================================================
     RESET PASSWORD
  ========================================================= */

  const resetForm = $("adminResetForm");
  const resetPasswordInput = $("adminResetPassword");
  const resetConfirmPasswordInput = $("adminResetConfirmPassword");
  const resetPasswordToggle = $("adminResetPasswordToggle");
  const resetConfirmPasswordToggle = $("adminResetConfirmPasswordToggle");
  const resetSubmitBtn = $("adminResetSubmitBtn");
  const resetErrorBox = $("adminResetError");
  const resetBackBtn = $("adminResetBackBtn");

  function clearResetError() {
    resetErrorBox.textContent = "";
    resetErrorBox.classList.remove("show");
  }

  function showResetError(message) {
    resetErrorBox.textContent = message;
    resetErrorBox.classList.add("show");
  }

  function togglePasswordVisibility(input, button) {
    button.addEventListener("click", e => {
      e.preventDefault();
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      button.textContent = isPassword ? "Hide" : "Show";
    });
  }

  togglePasswordVisibility(resetPasswordInput, resetPasswordToggle);
  togglePasswordVisibility(resetConfirmPasswordInput, resetConfirmPasswordToggle);

  resetBackBtn.addEventListener("click", showLoginScreen);

  resetForm.addEventListener("submit", async event => {
    event.preventDefault();
    clearResetError();

    const password = resetPasswordInput.value;
    const confirmPassword = resetConfirmPasswordInput.value;
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get("reset");

    if (!token) {
      showResetError("Invalid reset link. Please request a new password reset.");
      return;
    }

    if (!password) {
      showResetError("Please enter your new password.");
      resetPasswordInput.focus();
      return;
    }

    if (password.length < 8) {
      showResetError("Your password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      showResetError("Passwords do not match.");
      return;
    }

    resetSubmitBtn.disabled = true;
    resetSubmitBtn.textContent = "Resetting...";

    try {
      const response = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token, password, confirmPassword })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to reset password.");
      }

      alert("Password reset successfully! Please log in with your new password.");
      window.history.replaceState({}, document.title, "/admin-login.html");
      showLoginScreen();

    } catch (error) {
      showResetError(error.message || "Unable to reset password.");
      resetSubmitBtn.disabled = false;
      resetSubmitBtn.textContent = "Reset password";
    }
  });


  /* =========================================================
     CHECK FOR RESET TOKEN ON PAGE LOAD
  ========================================================= */

  const urlParams = new URLSearchParams(window.location.search);
  const resetToken = urlParams.get("reset");

  if (resetToken) {
    showResetScreen();
  }

});
