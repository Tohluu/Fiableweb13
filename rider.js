/* =====================================================
   RIDER ELEMENTS
===================================================== */

const riderLoginForm =
  document.getElementById(
    "riderLoginForm"
  );

const riderLoginEmail =
  document.getElementById(
    "riderLoginEmail"
  );

const riderLoginPassword =
  document.getElementById(
    "riderLoginPassword"
  );

const riderLoginBtn =
  document.getElementById(
    "riderLoginBtn"
  );

const riderLoginMessage =
  document.getElementById(
    "riderLoginMessage"
  );

const toggleRiderPassword =
  document.getElementById(
    "toggleRiderPassword"
  );


/* =====================================================
   RIDER PAGE PARAMETERS
===================================================== */

const riderParams =
  new URLSearchParams(
    window.location.search
  );

const isDashboard =
  riderParams.get("dashboard") === "true";


/* =====================================================
   SHOW / HIDE PASSWORD
===================================================== */

toggleRiderPassword?.addEventListener(
  "click",
  () => {

    if (
      riderLoginPassword.type ===
      "password"
    ) {

      riderLoginPassword.type =
        "text";

      toggleRiderPassword.textContent =
        "Hide";

      toggleRiderPassword.setAttribute(
        "aria-label",
        "Hide password"
      );

    } else {

      riderLoginPassword.type =
        "password";

      toggleRiderPassword.textContent =
        "Show";

      toggleRiderPassword.setAttribute(
        "aria-label",
        "Show password"
      );

    }

  }
);


/* =====================================================
   RIDER PAGE INITIALIZATION
===================================================== */

if (isDashboard) {

  const riderLoginCard =
    document.querySelector(
      ".rider-login-card"
    );

  const riderDashboardView =
    document.getElementById(
      "riderDashboardView"
    );


  /* Hide login */

  if (riderLoginCard) {

    riderLoginCard.style.display =
      "none";

  }


  /* Show dashboard */

  if (riderDashboardView) {

    riderDashboardView.style.display =
      "block";

  }

}


/* =====================================================
   RIDER LOGIN
===================================================== */

riderLoginForm?.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();


    const email =
      riderLoginEmail.value
        .trim()
        .toLowerCase();

    const password =
      riderLoginPassword.value;


    riderLoginMessage.textContent =
      "";


    if (!email || !password) {

      riderLoginMessage.textContent =
        "Email and password are required.";

      return;

    }


    riderLoginBtn.disabled =
      true;

    riderLoginBtn.textContent =
      "Signing in...";


    try {

      const response =
        await fetch(
          "/api/rider/login",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            credentials:
              "same-origin",

            body: JSON.stringify({
              email,
              password
            })
          }
        );


      const data =
        await response.json();


      if (!response.ok) {

        throw new Error(
          data.error ||
          "Unable to sign in."
        );

      }


      window.location.href =
        "rider.html?dashboard=true";


    } catch (error) {

      console.error(
        "RIDER LOGIN ERROR:",
        error
      );

      riderLoginMessage.textContent =
        error.message ||
        "Unable to sign in.";


    } finally {

      riderLoginBtn.disabled =
        false;

      riderLoginBtn.textContent =
        "Sign In";

    }

  }
);


/* =====================================================
   LOAD RIDER ACCOUNT
===================================================== */

async function loadRiderAccount() {

  try {

    const response =
      await fetch(
        "/api/rider/account",
        {
          method: "GET",

          credentials:
            "same-origin",

          cache: "no-store"
        }
      );


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data.error ||
        "Unable to load rider account."
      );

    }


    const rider =
      data.rider;


    if (!rider) {

      throw new Error(
        "Rider information not found."
      );

    }


    /* Rider ID */

    const riderRef =
      document.getElementById(
        "riderDashboardRef"
      );

    if (riderRef) {

      riderRef.textContent =
        rider.riderRef ||
        "—";

    }


    /* Rider Name */

    const riderName =
      document.getElementById(
        "riderDashboardName"
      );

    if (riderName) {

      riderName.textContent =
        rider.name ||
        "—";

    }


    /* Rider Phone */

    const riderPhone =
      document.getElementById(
        "riderDashboardPhone"
      );

    if (riderPhone) {

      riderPhone.textContent =
        rider.phone ||
        "—";

    }


    /* Rider Vehicle */

    const riderVehicle =
      document.getElementById(
        "riderDashboardVehicle"
      );

    if (riderVehicle) {

      riderVehicle.textContent =
        rider.vehicle ||
        "—";

    }


    /* Rider Status */

    const riderStatus =
      document.getElementById(
        "riderDashboardStatus"
      );

    if (riderStatus) {

      riderStatus.textContent =
        rider.status ||
        "—";

    }


    /* Welcome message */

    const riderWelcome =
      document.getElementById(
        "riderWelcome"
      );

    if (riderWelcome) {

      riderWelcome.textContent =
        `Welcome back, ${rider.name || "Rider"}.`;

    }


  } catch (error) {

    console.error(
      "RIDER ACCOUNT ERROR:",
      error
    );

  }

}

/* =====================================================
   LOAD CURRENT DELIVERY
===================================================== */

async function loadRiderDelivery() {

  const deliveryContainer =
    document.getElementById(
      "riderCurrentDelivery"
    );


  if (!deliveryContainer) {
    return;
  }


  try {

    const response =
      await fetch(
        "/api/rider/delivery",
        {
          method: "GET",

          credentials:
            "same-origin",

          cache: "no-store"
        }
      );


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data.error ||
        "Unable to load current delivery."
      );

    }


    const delivery =
      data.delivery;


    /* ---------------------------------------------
       NO ACTIVE DELIVERY
    --------------------------------------------- */

    if (!delivery) {

      deliveryContainer.innerHTML = `
        <div class="rider-empty-state">

          <h3>
            No delivery assigned
          </h3>

          <p>
            You currently have no active delivery.
          </p>

        </div>
      `;

      return;
    }


    /* ---------------------------------------------
       DELIVERY DETAILS
    --------------------------------------------- */

    const orderNumber =
      delivery.orderNumber ||
      delivery.orderRef ||
      delivery.id ||
      "—";

    const pickup =
      delivery.pickup ||
      "—";

    const destination =
      delivery.dropoff ||
      delivery.destination ||
      "—";

    const status =
      delivery.status ||
      "assigned";

    const units =
      delivery.units ??
      "—";


    deliveryContainer.innerHTML = `

      <div class="rider-delivery-card">

        <div class="rider-delivery-header">

          <div>

            <span class="rider-delivery-label">
              Order
            </span>

            <h3>
              ${orderNumber}
            </h3>

          </div>

          <span class="rider-delivery-status">
            ${status.replace("_", " ")}
          </span>

        </div>


        <div class="rider-delivery-details">

          <div class="rider-delivery-item">

            <span>
              Pickup
            </span>

            <strong>
              ${pickup}
            </strong>

          </div>


          <div class="rider-delivery-item">

            <span>
              Destination
            </span>

            <strong>
              ${destination}
            </strong>

          </div>


          <div class="rider-delivery-item">

            <span>
              Units
            </span>

            <strong>
              ${units}
            </strong>

          </div>

        </div>

      </div>

    `;


  } catch (error) {

    console.error(
      "RIDER DELIVERY ERROR:",
      error
    );

    deliveryContainer.innerHTML = `

      <div class="rider-empty-state">

        <h3>
          Unable to load delivery
        </h3>

        <p>
          Please refresh the page and try again.
        </p>

      </div>

    `;

  }

}


/* =====================================================
   LOAD ACCOUNT WHEN DASHBOARD OPENS
===================================================== */

if (isDashboard) {

  loadRiderAccount();

  loadRiderDelivery();

}


/* =====================================================
   RIDER LOGOUT
===================================================== */

document.addEventListener(
  "click",
  async (event) => {

    const logoutBtn =
      event.target.closest(
        "#riderLogoutBtn"
      );


    if (!logoutBtn) {
      return;
    }


    console.log(
      "RIDER LOGOUT BUTTON CLICKED"
    );


    logoutBtn.disabled =
      true;

    logoutBtn.textContent =
      "Logging out...";


    try {

      const response =
        await fetch(
          "/api/rider/logout",
          {
            method: "POST",

            credentials:
              "same-origin",

            headers: {
              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({})
          }
        );


      console.log(
        "RIDER LOGOUT RESPONSE:",
        response.status
      );


      const data =
        await response.json();


      if (!response.ok) {

        throw new Error(
          data.error ||
          "Unable to log out."
        );

      }


      window.location.href =
        "rider.html";


    } catch (error) {

      console.error(
        "RIDER LOGOUT ERROR:",
        error
      );


      logoutBtn.disabled =
        false;

      logoutBtn.textContent =
        "Logout";

    }

  }
);