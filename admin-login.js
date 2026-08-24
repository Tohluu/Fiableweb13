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

});