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

const riderForgotPasswordBtn =
  document.getElementById("riderForgotPasswordBtn");
const riderForgotPasswordForm =
  document.getElementById("riderForgotPasswordForm");
const riderResetPasswordForm =
  document.getElementById("riderResetPasswordForm");
const riderChangePasswordBtn =
  document.getElementById("riderChangePasswordBtn");
const riderChangePasswordForm =
  document.getElementById("riderChangePasswordForm");

document.querySelectorAll(".rider-nav-btn").forEach(button => {
  button.addEventListener("click", () => {
    const view = button.dataset.riderView;

    document.querySelectorAll(".rider-nav-btn").forEach(navButton => {
      navButton.classList.toggle(
        "active",
        navButton.dataset.riderView === view
      );
    });

    document.querySelectorAll(".rider-dashboard-view").forEach(panel => {
      panel.classList.toggle(
        "active",
        panel.dataset.riderViewPanel === view
      );
    });
  });
});


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

async function initializeRiderPage() {

  const riderAuthShell =
    document.getElementById(
      "riderAuthShell"
    ) || document.querySelector(
      ".rider-auth"
    );

  const riderLoginCard =
    document.querySelector(
      ".rider-login-card"
    );

  const riderDashboardView =
    document.getElementById(
      "riderDashboardView"
    );

  if (!riderLoginCard || !riderDashboardView) {
    return;
  }

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

    if (response.ok) {

      /* Authenticated rider */

      riderLoginCard.style.display =
        "none";

      riderDashboardView.style.display =
        "block";

      if (riderAuthShell) {
        riderAuthShell.classList.add(
          "rider-dashboard-mode"
        );
      }

      await loadRiderAccount();
      await loadRiderDelivery();
      await loadRiderPreviousDeliveries();

      startRiderAutoRefresh();

      return;
    }

    /* Not authenticated */

    if (riderParams.get("reset")) {
      riderLoginForm?.setAttribute("hidden", "true");
      riderForgotPasswordBtn?.setAttribute("hidden", "true");
      riderResetPasswordForm?.removeAttribute("hidden");
      riderLoginCard.style.display = "block";
      riderDashboardView.style.display = "none";
      return;
    }

    riderLoginCard.style.display =
      "block";

    riderDashboardView.style.display =
      "none";

    if (isDashboard) {
      window.location.replace("rider.html");
    }

  } catch (error) {

    console.error(
      "RIDER PAGE INIT ERROR:",
      error
    );

    riderLoginCard.style.display =
      "block";

    riderDashboardView.style.display =
      "none";

  }

}

initializeRiderPage();


/* =====================================================
   AUTOMATIC REFRESH MECHANISM
===================================================== */

let riderRefreshInterval = null;

function startRiderAutoRefresh() {

  const riderDashboardView =
    document.getElementById(
      "riderDashboardView"
    );

  const riderLoginCard =
    document.querySelector(
      ".rider-login-card"
    );

  if (
    !isDashboard ||
    !riderDashboardView ||
    !riderLoginCard ||
    riderLoginCard.style.display !== "none"
  ) {
    return;
  }

  /* Prevent duplicate intervals */

  if (riderRefreshInterval) {
    return;
  }


  /* Refresh every 5 seconds when page is visible */

  riderRefreshInterval =
    setInterval(
      async () => {

        if (
          document.visibilityState ===
          "visible"
        ) {

          try {

            await loadRiderDelivery();
            await loadRiderAccount();
            await loadRiderPreviousDeliveries();

          } catch (error) {

            console.error(
              "Auto-refresh error:",
              error
            );

          }

        }

      },
      5000
    );

}

function stopRiderAutoRefresh() {

  if (riderRefreshInterval) {

    clearInterval(riderRefreshInterval);
    riderRefreshInterval = null;

  }

}

/* Start refresh when dashboard loads */

document.addEventListener(
  "visibilitychange",
  () => {

    if (
      document.visibilityState ===
      "visible"
    ) {

      startRiderAutoRefresh();

    } else if (
      document.visibilityState ===
      "hidden"
    ) {

      stopRiderAutoRefresh();

    }

  }
);


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

riderForgotPasswordBtn?.addEventListener("click", () => {
  riderLoginForm?.setAttribute("hidden", "true");
  riderForgotPasswordBtn.setAttribute("hidden", "true");
  riderForgotPasswordForm?.removeAttribute("hidden");
});

document.getElementById("riderBackToLoginBtn")?.addEventListener("click", () => {
  riderForgotPasswordForm?.setAttribute("hidden", "true");
  riderLoginForm?.removeAttribute("hidden");
  riderForgotPasswordBtn?.removeAttribute("hidden");
});

riderForgotPasswordForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.getElementById("riderForgotMessage");
  const email = document.getElementById("riderForgotEmail")?.value.trim().toLowerCase();
  try {
    const response = await fetch("/api/rider/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to create reset link.");
    message.textContent = data.resetLink
      ? `Reset link: ${data.resetLink}`
      : data.message;
  } catch (error) {
    message.textContent = error.message;
  }
});

riderResetPasswordForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.getElementById("riderResetMessage");
  try {
    const response = await fetch("/api/rider/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        token: riderParams.get("reset"),
        password: document.getElementById("riderResetPassword")?.value,
        confirmPassword: document.getElementById("riderResetConfirmPassword")?.value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to reset password.");
    message.textContent = data.message;
    setTimeout(() => window.location.replace("rider.html"), 800);
  } catch (error) {
    message.textContent = error.message;
  }
});

riderChangePasswordBtn?.addEventListener("click", () => {
  riderChangePasswordForm?.toggleAttribute("hidden");
});

riderChangePasswordForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.getElementById("riderChangePasswordMessage");
  const newPassword = document.getElementById("riderNewPassword")?.value;
  const confirmPassword = document.getElementById("riderConfirmPassword")?.value;
  if (newPassword !== confirmPassword) {
    message.textContent = "Passwords do not match.";
    return;
  }
  try {
    const response = await fetch("/api/rider/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        currentPassword: document.getElementById("riderCurrentPassword")?.value,
        newPassword
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to change password.");
    message.textContent = data.message;
    riderChangePasswordForm.reset();
  } catch (error) {
    message.textContent = error.message;
  }
});


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
   UPDATE RIDER DELIVERY STATUS
===================================================== */

async function updateRiderDeliveryStatus(
  orderId,
  newStatus,
  buttonElement
) {

  try {

    const response =
      await fetch(
        "/api/rider/delivery/status",
        {
          method: "POST",

          credentials:
            "same-origin",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            orderId,
            status: newStatus
          })
        }
      );


    const data =
      await response.json();


    if (!response.ok) {

      /* Handle specific error cases */

      if (response.status === 401) {
        throw new Error(
          "Your session has expired. Please log in again."
        );
      }

      if (response.status === 403) {
        throw new Error(
          "You are not assigned to this delivery."
        );
      }

      if (response.status === 404) {
        throw new Error(
          "Order not found."
        );
      }

      if (response.status === 400) {
        throw new Error(
          data.error ||
          "Invalid status transition."
        );
      }

      throw new Error(
        data.error ||
        "Unable to update delivery status."
      );

    }

    console.log(
      "UPDATED ORDER:",
      data.order
    );

    console.log(
      "UPDATED RIDER:",
      data.rider
    );

    /* Success - reload UI */

    await loadRiderDelivery();
    await loadRiderAccount();

    return true;


  } catch (error) {

    console.error(
      "RIDER STATUS UPDATE ERROR:",
      error
    );

    /* Reset button state on error */

    if (buttonElement) {

      buttonElement.disabled = false;

      if (newStatus === "on_delivery") {
        buttonElement.textContent =
          "Start Delivery";
      } else if (newStatus === "delivered") {
        buttonElement.textContent =
          "Mark Delivered";
      }

    }

    throw error;

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


    /* NO ACTIVE DELIVERY */

    if (!delivery) {

      deliveryContainer.innerHTML = `
        <div class="rider-empty-state">
          <h3>No delivery assigned</h3>
          <p>You currently have no active delivery.</p>
        </div>
      `;

      return;
    }


    /* EXTRACT DELIVERY FIELDS */

    const orderRef =
      delivery.orderRef ||
      delivery.id ||
      "—";

    const status =
      String(
        delivery.status || "assigned"
      ).toLowerCase();

    const pickup =
      delivery.pickup ||
      "—";

    const dropoff =
      delivery.dropoff ||
      "—";

    const units =
      delivery.units ?? "—";

    const details =
      delivery.details || {};

    const pickupContactName =
      details.pickupContactName || "—";

    const pickupPhone =
      details.pickupPhone || "—";

    const recipientName =
      details.recipientName || "—";

    const recipientPhone =
      details.recipientPhone || "—";

    const packageType =
      details.packageType ||
      delivery.packageType ||
      "—";

    const priority =
      details.priority ||
      delivery.priority ||
      "—";

    const deliveryWindow =
      details.deliveryWindow ||
      "—";

    const packageDescription =
      details.packageDescription ||
      delivery.packageDescription ||
      "—";


    /* ACTION BUTTON */

    let actionButton = "";

    if (status === "assigned") {

      actionButton = `
        <button
          type="button"
          class="rider-delivery-action-btn"
          data-order-id="${delivery.id}"
          data-status="on_delivery"
        >
          Start Delivery
        </button>
      `;

    } else if (status === "on_delivery") {

      actionButton = `
        <button
          type="button"
          class="rider-delivery-action-btn"
          data-order-id="${delivery.id}"
          data-status="delivered"
        >
          Mark Delivered
        </button>
      `;

    } else if (status === "delivered") {

      actionButton = `
        <div class="rider-delivery-completed">
          Delivery Completed
        </div>
      `;

    }


    /* DISPLAY DELIVERY CARD */

    deliveryContainer.innerHTML = `

      <div class="rider-delivery-card">

        <div class="rider-delivery-header">

          <div>
            <span class="rider-delivery-label">
              Order
            </span>
            <h3>${orderRef}</h3>
          </div>

          <span class="rider-delivery-status">
            ${status.replace("_", " ")}
          </span>

        </div>


        <div class="rider-delivery-details">

          <div class="rider-delivery-item">
            <span>Pickup</span>
            <strong>${pickup}</strong>
          </div>

          <div class="rider-delivery-item">
            <span>Destination</span>
            <strong>${dropoff}</strong>
          </div>

          <div class="rider-delivery-item">
            <span>Recipient</span>
            <strong>${recipientName}</strong>
          </div>

          <div class="rider-delivery-item">
            <span>Package Type</span>
            <strong>${packageType}</strong>
          </div>

          <div class="rider-delivery-item">
            <span>Units</span>
            <strong>${units}</strong>
          </div>

          <div class="rider-delivery-item">
            <span>Priority</span>
            <strong>${priority}</strong>
          </div>

        </div>


        <div class="rider-delivery-actions">

          <button
            type="button"
            class="rider-view-order-btn"
            data-order-id="${delivery.id}"
            data-order-ref="${orderRef}"
            data-pickup="${pickup}"
            data-dropoff="${dropoff}"
            data-pickup-contact="${pickupContactName}"
            data-pickup-phone="${pickupPhone}"
            data-recipient="${recipientName}"
            data-recipient-phone="${recipientPhone}"
            data-package-type="${packageType}"
            data-description="${packageDescription}"
            data-units="${units}"
            data-priority="${priority}"
            data-window="${deliveryWindow}"
            data-status="${status}"
          >
            View Order
          </button>

          ${actionButton}

        </div>

      </div>

    `;


    /* ATTACH VIEW ORDER HANDLER */

    const viewOrderBtn =
      deliveryContainer.querySelector(
        ".rider-view-order-btn"
      );

    if (viewOrderBtn) {

      viewOrderBtn.addEventListener(
        "click",
        () => {
          openOrderDetailsModal(delivery);
        }
      );

    }


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
   LOAD PREVIOUS DELIVERIES
===================================================== */

async function loadRiderPreviousDeliveries() {

  const historyContainer =
    document.getElementById(
      "riderPreviousDeliveries"
    );

  if (!historyContainer) {
    return;
  }

  try {

    const response = await fetch(
      "/api/rider/deliveries",
      {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store"
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
        "Unable to load delivery history."
      );
    }

    const deliveries = data.deliveries || [];

    if (!deliveries.length) {
      historyContainer.innerHTML = `
        <div class="rider-empty-state">
          <p>No previous deliveries yet.</p>
        </div>
      `;
      return;
    }

    historyContainer.innerHTML = `
      <div class="rider-history-table-wrap">
        <table class="rider-history-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Route</th>
              <th>Units</th>
              <th>Status</th>
              <th>Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${deliveries.map(delivery => `
              <tr>
                <td>${delivery.orderRef || `#${delivery.id}`}</td>
                <td>${delivery.pickup || "—"} → ${delivery.dropoff || "—"}</td>
                <td>${delivery.units ?? "—"}</td>
                <td><span class="rider-history-status rider-history-status-${delivery.status}">${String(delivery.status || "—").replace("_", " ")}</span></td>
                <td>${delivery.updatedAt ? new Date(delivery.updatedAt).toLocaleDateString("en-GB") : "—"}</td>
                <td><button type="button" class="rider-history-view-btn" data-order-id="${delivery.id}">View</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    historyContainer
      .querySelectorAll(".rider-history-view-btn")
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            const delivery = deliveries.find(
              item => String(item.id) === button.dataset.orderId
            );
            if (delivery) {
              openOrderDetailsModal(delivery);
            }
          }
        );
      });

  } catch (error) {

    console.error(
      "RIDER DELIVERY HISTORY ERROR:",
      error
    );

    historyContainer.innerHTML = `
      <div class="rider-empty-state">
        <p>Unable to load delivery history.</p>
      </div>
    `;

  }

}


/* =====================================================
   OPEN ORDER DETAILS MODAL
===================================================== */

function openOrderDetailsModal(delivery) {

  const modal =
    document.getElementById(
      "riderOrderModal"
    );

  const modalBody =
    document.getElementById(
      "riderModalBody"
    );

  if (!modal || !modalBody) {
    return;
  }

  const details =
    delivery.details || {};

  const orderRef =
    delivery.orderRef ||
    delivery.id ||
    "Order";

  const status =
    String(
      delivery.status || "assigned"
    ).toLowerCase();

  const pickup =
    delivery.pickup || "—";

  const dropoff =
    delivery.dropoff || "—";

  const units =
    delivery.units ?? "—";

  const pickupContactName =
    details.pickupContactName || "—";

  const pickupPhone =
    details.pickupPhone || "—";

  const pickupAddress =
    details.pickupAddress || "—";

  const recipientName =
    details.recipientName || "—";

  const recipientPhone =
    details.recipientPhone || "—";

  const deliveryAddress =
    details.deliveryAddress || "—";

  const packageType =
    details.packageType ||
    delivery.packageType ||
    "—";

  const priority =
    details.priority ||
    delivery.priority ||
    "—";

  const deliveryWindow =
    details.deliveryWindow || "—";

  const packageDescription =
    details.packageDescription ||
    delivery.packageDescription ||
    "—";

  modalBody.innerHTML = `

    <div class="rider-order-detail-section">

      <h3>Order Information</h3>

      <div class="rider-order-detail-grid">

        <div class="rider-order-detail-item">
          <span>Order Reference</span>
          <strong>${orderRef}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Status</span>
          <strong>${status.replace("_", " ").toUpperCase()}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Units</span>
          <strong>${units}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Priority</span>
          <strong>${priority}</strong>
        </div>

      </div>

    </div>


    <div class="rider-order-detail-section">

      <h3>Pickup Details</h3>

      <div class="rider-order-detail-grid">

        <div class="rider-order-detail-item">
          <span>Location</span>
          <strong>${pickup}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Contact Name</span>
          <strong>${pickupContactName}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Contact Phone</span>
          <strong>${pickupPhone}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Pickup Address</span>
          <strong>${pickupAddress}</strong>
        </div>

      </div>

    </div>


    <div class="rider-order-detail-section">

      <h3>Delivery Details</h3>

      <div class="rider-order-detail-grid">

        <div class="rider-order-detail-item">
          <span>Destination</span>
          <strong>${dropoff}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Recipient Name</span>
          <strong>${recipientName}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Recipient Phone</span>
          <strong>${recipientPhone}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Delivery Address</span>
          <strong>${deliveryAddress}</strong>
        </div>

      </div>

    </div>


    <div class="rider-order-detail-section">

      <h3>Package Information</h3>

      <div class="rider-order-detail-grid">

        <div class="rider-order-detail-item">
          <span>Package Type</span>
          <strong>${packageType}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Delivery Window</span>
          <strong>${deliveryWindow}</strong>
        </div>

      </div>

      ${packageDescription && packageDescription !== "—" ? `

        <div class="rider-order-detail-item" style="margin-block-start: 16px;">
          <span>Description</span>
          <strong>${packageDescription}</strong>
        </div>

      ` : ""}

    </div>

  `;

  /* Add action buttons to modal footer */

  const modalFooter =
    document.getElementById(
      "riderModalFooter"
    );

  if (modalFooter) {

    let actionButtons = `
      <button
        type="button"
        class="rider-modal-close-btn"
        onclick="closeOrderDetailsModal()"
      >
        Close
      </button>
    `;

    if (status === "assigned") {

      actionButtons = `
        <button
          type="button"
          class="rider-modal-close-btn"
          onclick="closeOrderDetailsModal()"
        >
          Close
        </button>

        <button
          type="button"
          class="rider-modal-action-btn"
          data-order-id="${delivery.id}"
          data-status="on_delivery"
          onclick="handleModalActionClick(event)"
        >
          Start Delivery
        </button>
      `;

    } else if (status === "on_delivery") {

      actionButtons = `
        <button
          type="button"
          class="rider-modal-close-btn"
          onclick="closeOrderDetailsModal()"
        >
          Close
        </button>

        <button
          type="button"
          class="rider-modal-action-btn"
          data-order-id="${delivery.id}"
          data-status="delivered"
          onclick="handleModalActionClick(event)"
        >
          Mark as Delivered
        </button>
      `;

    } else if (status === "delivered") {

      actionButtons = `
        <button
          type="button"
          class="rider-modal-close-btn"
          onclick="closeOrderDetailsModal()"
        >
          Close
        </button>
      `;

    }

    modalFooter.innerHTML = actionButtons;

  }

  modal.hidden = false;

}

/* =====================================================
   HANDLE MODAL ACTION CLICK
===================================================== */

async function handleModalActionClick(event) {

  const button = event.target;

  const orderId =
    button.dataset.orderId;

  const newStatus =
    button.dataset.status;

  if (!orderId || !newStatus) {
    return;
  }

  button.disabled = true;

  const originalText =
    button.textContent;

  button.textContent =
    newStatus === "on_delivery"
      ? "Starting..."
      : "Completing...";

  try {

    await updateRiderDeliveryStatus(
      orderId,
      newStatus,
      button
    );

    closeOrderDetailsModal();


  } catch (error) {

    console.error(
      "Failed to update status:",
      error
    );

    alert(
      error.message ||
      "Failed to update delivery status."
    );

  }

}

/* =====================================================
   CLOSE ORDER DETAILS MODAL
===================================================== */

function closeOrderDetailsModal() {

  const modal =
    document.getElementById(
      "riderOrderModal"
    );

  if (modal) {
    modal.hidden = true;
  }

}

/* =====================================================
   MODAL EVENT HANDLERS
===================================================== */

document.addEventListener("DOMContentLoaded", () => {

  const closeBtn =
    document.getElementById(
      "riderModalCloseBtn"
    );

  const backdrop =
    document.querySelector(
      ".rider-modal-backdrop"
    );

  const modal =
    document.getElementById(
      "riderOrderModal"
    );

  if (closeBtn) {
    closeBtn.addEventListener(
      "click",
      closeOrderDetailsModal
    );
  }

  if (backdrop) {
    backdrop.addEventListener(
      "click",
      closeOrderDetailsModal
    );
  }

  if (modal) {
    modal.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          closeOrderDetailsModal();
        }
      }
    );
  }

});


/* =====================================================
   RIDER DELIVERY ACTION BUTTON
===================================================== */

document.addEventListener(
  "click",
  async (event) => {

    const button =
      event.target.closest(
        ".rider-delivery-action-btn"
      );


    if (!button) {
      return;
    }


    const orderId =
      button.dataset.orderId;

    const newStatus =
      button.dataset.status;


    if (!orderId || !newStatus) {
      console.error(
        "Missing order ID or status"
      );
      return;
    }


    /* Disable button and show loading state */

    button.disabled = true;

    const originalText =
      button.textContent;

    button.textContent =
      newStatus === "on_delivery"
        ? "Starting..."
        : "Completing...";


    try {

      await updateRiderDeliveryStatus(
        orderId,
        newStatus,
        button
      );

      /* Success - UI refreshed by updateRiderDeliveryStatus */

      console.log(
        "Delivery status updated successfully"
      );


    } catch (error) {

      console.error(
        "Failed to update status:",
        error
      );

      /* Show error message to user */

      alert(
        error.message ||
        "Failed to update delivery status."
      );

    }

  }
);

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

      stopRiderAutoRefresh();

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