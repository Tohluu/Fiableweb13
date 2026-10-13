/* =====================================================
   RIDER ELEMENTS
===================================================== */

function escapeRiderHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatStatusLabel(status) {
  return escapeRiderHtml(String(status || "").replace(/_/g, " "));
}

function selectRiderView(view) {
  document.querySelectorAll('.rider-nav-btn').forEach(button => {
    const selected = button.dataset.riderView === view;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.rider-dashboard-view').forEach(panel => {
    panel.classList.toggle('active', panel.dataset.riderViewPanel === view);
  });
}

async function riderFetch(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401 && options?.method !== 'POST' &&
      document.getElementById('riderDashboardView')?.style.display === 'block') {
    stopRiderAutoRefresh();
    window.location.replace('rider.html?expired=true');
    throw new Error('Your session has expired. Please sign in again.');
  }
  return response;
}

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
    selectRiderView(button.dataset.riderView);
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
      await riderFetch(
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
      if (!riderMustChangePassword) {
        await loadRiderDelivery();
        await loadRiderPreviousDeliveries();
        await loadRiderNotifications();
      }

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

/* =====================================================
   AUTOMATIC REFRESH MECHANISM
===================================================== */

let riderRefreshInterval = null;
let riderRefreshInFlight = false;
let riderActionInFlight = false;
let riderModalReturnFocus = null;
let riderMustChangePassword = false;
const riderCameraPhotos = new WeakMap();

function clearRiderPhoto(form) {
  const selected = riderCameraPhotos.get(form);
  if (selected) URL.revokeObjectURL(selected.url);
  riderCameraPhotos.delete(form);
  const controls = form.querySelector('.rider-photo-controls');
  if (!controls) return;
  const preview = controls.querySelector('.rider-photo-preview');
  preview.hidden = true;
  preview.removeAttribute('src');
  controls.querySelector('.rider-photo-message').textContent = '';
  controls.querySelector('.rider-proof-photo').required = controls.dataset.requirePhoto === 'true';
  controls.querySelector('.rider-camera-btn').textContent = 'Take photo';
}

document.addEventListener('click', event => {
  const button = event.target.closest('.rider-camera-btn');
  if (!button) return;
  button.closest('.rider-proof-form').querySelector('.rider-proof-camera').click();
});

document.addEventListener('change', event => {
  const input = event.target;
  if (!input.matches('.rider-proof-camera, .rider-proof-photo')) return;
  const form = input.closest('.rider-proof-form');
  const file = input.files?.[0];
  if (!file) return; // Closing the camera/picker preserves the last selection.
  clearRiderPhoto(form);
  const message = form.querySelector('.rider-photo-message');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
    form.querySelector('.rider-proof-photo').value = '';
    form.querySelector('.rider-proof-camera').value = '';
    message.textContent = 'Choose a PNG, JPEG or WebP photo up to 5 MB.';
    return;
  }
  const isCamera = input.classList.contains('rider-proof-camera');
  form.querySelector(isCamera ? '.rider-proof-photo' : '.rider-proof-camera').value = '';
  const url = URL.createObjectURL(file);
  riderCameraPhotos.set(form, { file, url });
  form.querySelector('.rider-proof-photo').required = false;
  const preview = form.querySelector('.rider-photo-preview');
  preview.src = url;
  preview.hidden = false;
  message.textContent = isCamera ? 'Camera photo ready. You can retake it or upload a different photo.' : `Photo selected: ${file.name}`;
  form.querySelector('.rider-camera-btn').textContent = isCamera ? 'Retake photo' : 'Take photo';
});

document.addEventListener('reset', event => {
  if (event.target.matches('.rider-proof-form')) clearRiderPhoto(event.target);
});

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
          "visible" && !riderRefreshInFlight && !riderActionInFlight
        ) {

          try {
            riderRefreshInFlight = true;
            await loadRiderAccount();
            if (riderMustChangePassword) return;
            await loadRiderDelivery();
            await loadRiderPreviousDeliveries();
            await loadRiderNotifications();

          } catch (error) {

            console.error(
              "Auto-refresh error:",
              error
            );

          } finally {
            riderRefreshInFlight = false;
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
        await riderFetch(
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
    const response = await riderFetch("/api/rider/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to create reset link.");
    if (data.resetLink) {
      window.location.href = data.resetLink;
      return;
    }
    message.dataset.kind = 'success';
    message.textContent = data.message || 'Your password reset request has been received.';
  } catch (error) {
    message.dataset.kind = 'error';
    message.textContent = error.message;
  }
});

riderResetPasswordForm?.addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.getElementById("riderResetMessage");
  const password = document.getElementById('riderResetPassword').value;
  if (password !== document.getElementById('riderResetConfirmPassword').value) {
    message.dataset.kind = 'error';
    message.textContent = 'Passwords do not match.';
    return;
  }
  try {
    const response = await riderFetch("/api/rider/reset-password", {
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
    message.dataset.kind = 'success';
    message.textContent = data.message;
    setTimeout(() => window.location.replace("rider.html"), 800);
  } catch (error) {
    message.dataset.kind = 'error';
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
    message.dataset.kind = 'error';
    message.textContent = 'Passwords do not match.';
    return;
  }
  try {
    const response = await riderFetch("/api/rider/change-password", {
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
    message.dataset.kind = 'success';
    message.textContent = data.message;
    riderChangePasswordForm.reset();
    riderChangePasswordForm.hidden = true;
    await loadRiderAccount();
    await loadRiderDelivery();
    await loadRiderPreviousDeliveries();
    await loadRiderNotifications();
  } catch (error) {
    message.dataset.kind = 'error';
    message.textContent = error.message;
  }
});


/* =====================================================
   LOAD RIDER ACCOUNT
===================================================== */

async function loadRiderAccount() {

  try {

    const response =
      await riderFetch(
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


    riderMustChangePassword = !!rider.mustChangePassword;

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

    /* Force a password change if this account still has a temporary password */

    if (rider.mustChangePassword && riderChangePasswordForm?.hasAttribute("hidden")) {
      selectRiderView('settings');
      riderChangePasswordForm.removeAttribute("hidden");
      const changeMessage = document.getElementById("riderChangePasswordMessage");
      if (changeMessage) {
        changeMessage.dataset.kind = 'warning';
        changeMessage.textContent = "You're using a temporary password. Please set a new one to continue.";
      }
    }


  } catch (error) {

    console.error(
      "RIDER ACCOUNT ERROR:",
      error
    );

  }

}

/* =====================================================
   RIDER LIFECYCLE ACTIONS (accept/decline/advance/complete)
===================================================== */

function renderLifecycleActions(delivery) {
  const status = String(delivery.status || "assigned").toLowerCase();
  const orderId = escapeRiderHtml(delivery.id);

  if (status === "assigned") {
    return `
      <button type="button" class="rider-delivery-action-btn" data-order-id="${orderId}" data-action="accept">Accept</button>
      <button type="button" class="rider-delivery-decline-btn" data-order-id="${orderId}" data-action="decline">Decline</button>
    `;
  }
  if (status === "rider_accepted") {
    return `<button type="button" class="rider-delivery-action-btn" data-order-id="${orderId}" data-action="advance" data-next-status="arriving_at_pickup">Heading to Pickup</button>`;
  }
  if (status === "arriving_at_pickup") {
    return `<button type="button" class="rider-delivery-action-btn" data-order-id="${orderId}" data-action="advance" data-next-status="picked_up">Mark Picked Up</button>`;
  }
  if (status === "picked_up") {
    return `<button type="button" class="rider-delivery-action-btn" data-order-id="${orderId}" data-action="advance" data-next-status="on_delivery">Start Delivery</button>`;
  }
  if (status === "on_delivery") {
    const requirements = delivery.proofRequirements || { requireRecipientName: true, requirePhoto: true };
    return `
      <form class="rider-proof-form" data-order-id="${orderId}" data-require-gps="${!!requirements.requireGps}">
        <h4>Proof of delivery</h4>
        <label>Recipient name
          <input type="text" class="rider-proof-recipient" maxlength="120" placeholder="Who received it?" ${requirements.requireRecipientName ? 'required' : ''}>
        </label>
        <div class="rider-photo-controls" data-require-photo="${!!requirements.requirePhoto}">
        <label>Upload delivery photo
          <input type="file" class="rider-proof-photo" accept="image/png,image/jpeg,image/webp" ${requirements.requirePhoto ? 'required' : ''}>
        </label>
        <button type="button" class="rider-camera-btn">Take photo</button>
        <input type="file" class="rider-proof-camera" accept="image/*" capture="environment" aria-label="Take a delivery photo with your camera" hidden>
        <p class="rider-photo-message" role="status" aria-live="polite"></p>
        <img class="rider-photo-preview" alt="Selected delivery photo" hidden>
        </div>
        <small>PNG, JPEG or WebP. Maximum 5 MB per file.</small>
        ${requirements.requireOtp ? '<label>Recipient delivery code<input class="rider-proof-otp" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>' : ''}
        ${requirements.requireSignature ? '<label>Recipient signature image<input class="rider-proof-signature" type="file" accept="image/png,image/jpeg,image/webp" required></label>' : ''}
        ${requirements.requireGps ? '<small>Your location will be requested when you complete this delivery.</small>' : ''}
        <button type="submit" class="rider-delivery-action-btn">Complete Delivery</button>
      </form>
    `;
  }
  if (["delivered", "failed", "cancelled", "returned"].includes(status)) {
    return `<div class="rider-delivery-completed">${formatStatusLabel(status)}</div>`;
  }
  return "";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function respondToAssignment(orderId, accept, reason) {
  const endpoint = accept ? "/api/rider/delivery/accept" : "/api/rider/delivery/decline";
  const response = await riderFetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(accept ? { orderId } : { orderId, reason })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Unable to update this assignment.");
  }
  closeOrderDetailsModal();
  await loadRiderDelivery();
  await loadRiderAccount();
  return data;
}

async function completeDeliveryWithProof(orderId, recipientName, photoFile, extraProof = {}) {
  for (const file of [photoFile, extraProof.signatureFile].filter(Boolean)) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
    if (!file.size || file.size > 5 * 1024 * 1024) throw new Error('Each image must be between 1 byte and 5 MB.');
  }
  const photo = photoFile ? await fileToDataUrl(photoFile) : null;
  const signature = extraProof.signatureFile ? await fileToDataUrl(extraProof.signatureFile) : null;
  const response = await riderFetch("/api/rider/delivery/complete", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, recipientName: recipientName.trim(), photo, signature, otp: extraProof.otp, gps: extraProof.gps })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Unable to complete this delivery.");
  }
  document.querySelectorAll('.rider-proof-form').forEach(form => {
    if (String(form.dataset.orderId) !== String(orderId)) return;
    form.reset();
    if (form.contains(document.activeElement)) document.activeElement.blur();
    form.closest('.rider-delivery-card')?.remove();
  });
  closeOrderDetailsModal();
  await loadRiderDelivery();
  await loadRiderAccount();
  await loadRiderPreviousDeliveries();
  return data;
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
      await riderFetch(
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



    /* Success - reload UI */

    await loadRiderDelivery();
    await loadRiderAccount();
    await loadRiderPreviousDeliveries();
    closeOrderDetailsModal();
    return true;


  } catch (error) {

    console.error(
      "RIDER STATUS UPDATE ERROR:",
      error
    );

    /* Reset button state on error */

    if (buttonElement) {
      buttonElement.disabled = false;
    }

    throw error;

  }

}


/* =====================================================
   LOAD CURRENT DELIVERY
===================================================== */

async function loadRiderDelivery() {
  // Keep a rider's photo, name and code intact while they prepare proof.
  if ([...document.querySelectorAll('#riderCurrentDelivery .rider-proof-form')]
      .some(form => riderCameraPhotos.has(form))) return;
  if ([...document.querySelectorAll('#riderCurrentDelivery .rider-proof-form input')]
      .some(input => input.value || input.files?.length || input === document.activeElement)) return;

  const deliveryContainer =
    document.getElementById(
      "riderCurrentDelivery"
    );

  const badgeElement =
    document.getElementById(
      "deliveryCountBadge"
    );

  if (!deliveryContainer) {
    return;
  }

  try {

    const response =
      await riderFetch(
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

    const deliveries =
      data.deliveries || [];

    const count = data.count || 0;

    /* UPDATE BADGE */

    if (badgeElement) {
      if (count > 0) {
        badgeElement.textContent = count;
        badgeElement.classList.remove("hidden");
      } else {
        badgeElement.classList.add("hidden");
      }
    }

    /* NO ACTIVE DELIVERIES */

    if (!deliveries || deliveries.length === 0) {

      deliveryContainer.innerHTML = `
        <div class="rider-empty-state">
          <h3>No delivery assigned</h3>
          <p>You currently have no active delivery.</p>
        </div>
      `;

      return;
    }

    /* RENDER ALL ASSIGNED DELIVERIES */

    deliveryContainer.innerHTML = deliveries
      .map(delivery => renderDeliveryCard(delivery))
      .join("");

    /* ATTACH EVENT HANDLERS */

    deliveryContainer.querySelectorAll(".rider-view-order-btn")
      .forEach(btn => {
        btn.addEventListener("click", () => {
          const orderId = Number(btn.dataset.orderId);
          const assignedDelivery = deliveries.find(d => Number(d.id) === orderId);
          if (assignedDelivery) {
            openOrderDetailsModal(assignedDelivery);
          }
        });
      });

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

function renderDeliveryCard(delivery) {

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

  const actionButton = renderLifecycleActions(delivery);

  return `

    <div class="rider-delivery-card">

      <div class="rider-delivery-header">

        <div>
          <span class="rider-delivery-label">
            Order
          </span>
          <h3>${escapeRiderHtml(orderRef)}</h3>
        </div>

        <span class="rider-delivery-status rider-status-${escapeRiderHtml(status.replace(/[^a-z_]/g, ''))}">
          ${formatStatusLabel(status)}
        </span>

      </div>

      <div class="rider-delivery-details">

        <div class="rider-delivery-item">
          <span>Pickup</span>
          <strong>${escapeRiderHtml(pickup)}</strong>
        </div>

        <div class="rider-delivery-item">
          <span>Destination</span>
          <strong>${escapeRiderHtml(dropoff)}</strong>
        </div>

        <div class="rider-delivery-item">
          <span>Recipient</span>
          <strong>${escapeRiderHtml(recipientName)}</strong>
        </div>

        <div class="rider-delivery-item">
          <span>Package Type</span>
          <strong>${escapeRiderHtml(packageType)}</strong>
        </div>

        <div class="rider-delivery-item">
          <span>Units</span>
          <strong>${escapeRiderHtml(units)}</strong>
        </div>

        <div class="rider-delivery-item">
          <span>Priority</span>
          <strong>${escapeRiderHtml(priority)}</strong>
        </div>

      </div>

      <div class="rider-delivery-actions">

        <button
          type="button"
          class="rider-view-order-btn"
          data-order-id="${escapeRiderHtml(delivery.id)}"
          data-order-ref="${escapeRiderHtml(orderRef)}"
          data-pickup="${escapeRiderHtml(pickup)}"
          data-dropoff="${escapeRiderHtml(dropoff)}"
          data-pickup-contact="${escapeRiderHtml(pickupContactName)}"
          data-pickup-phone="${escapeRiderHtml(pickupPhone)}"
          data-recipient="${escapeRiderHtml(recipientName)}"
          data-recipient-phone="${escapeRiderHtml(recipientPhone)}"
          data-package-type="${escapeRiderHtml(packageType)}"
          data-description="${escapeRiderHtml(packageDescription)}"
          data-units="${escapeRiderHtml(units)}"
          data-priority="${escapeRiderHtml(priority)}"
          data-window="${escapeRiderHtml(deliveryWindow)}"
          data-status="${escapeRiderHtml(status)}"
        >
          View Order
        </button>

        ${actionButton}

      </div>

    </div>

  `;

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

    const response = await riderFetch(
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
                <td>${escapeRiderHtml(delivery.orderRef || `#${delivery.id}`)}</td>
                <td>${escapeRiderHtml(delivery.pickup || "—")} → ${escapeRiderHtml(delivery.dropoff || "—")}</td>
                <td>${escapeRiderHtml(delivery.units ?? "—")}</td>
                <td><span class="rider-history-status rider-history-status-${escapeRiderHtml(String(delivery.status || '').replace(/[^a-z_]/g, ''))}">${formatStatusLabel(delivery.status || "—")}</span></td>
                <td>${delivery.updatedAt ? new Date(delivery.updatedAt).toLocaleDateString("en-GB") : "—"}</td>
                <td><button type="button" class="rider-history-view-btn" data-order-id="${escapeRiderHtml(delivery.id)}">View</button></td>
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
          <strong>${escapeRiderHtml(orderRef)}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Status</span>
          <strong>${escapeRiderHtml(String(status).replace(/_/g, ' ').toUpperCase())}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Units</span>
          <strong>${escapeRiderHtml(units)}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Priority</span>
          <strong>${escapeRiderHtml(priority)}</strong>
        </div>

      </div>

    </div>


    <div class="rider-order-detail-section">

      <h3>Pickup Details</h3>

      <div class="rider-order-detail-grid">

        <div class="rider-order-detail-item">
          <span>Location</span>
          <strong>${escapeRiderHtml(pickup)}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Contact Name</span>
          <strong>${escapeRiderHtml(pickupContactName)}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Contact Phone</span>
          <strong>${escapeRiderHtml(pickupPhone)}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Pickup Address</span>
          <strong>${escapeRiderHtml(pickupAddress)}</strong>
        </div>

      </div>

    </div>


    <div class="rider-order-detail-section">

      <h3>Delivery Details</h3>

      <div class="rider-order-detail-grid">

        <div class="rider-order-detail-item">
          <span>Destination</span>
          <strong>${escapeRiderHtml(dropoff)}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Recipient Name</span>
          <strong>${escapeRiderHtml(recipientName)}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Recipient Phone</span>
          <strong>${escapeRiderHtml(recipientPhone)}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Delivery Address</span>
          <strong>${escapeRiderHtml(deliveryAddress)}</strong>
        </div>

      </div>

    </div>


    <div class="rider-order-detail-section">

      <h3>Package Information</h3>

      <div class="rider-order-detail-grid">

        <div class="rider-order-detail-item">
          <span>Package Type</span>
          <strong>${escapeRiderHtml(packageType)}</strong>
        </div>

        <div class="rider-order-detail-item">
          <span>Delivery Window</span>
          <strong>${escapeRiderHtml(deliveryWindow)}</strong>
        </div>

      </div>

      ${packageDescription && packageDescription !== "—" ? `

        <div class="rider-order-detail-item" style="margin-block-start: 16px;">
          <span>Description</span>
          <strong>${escapeRiderHtml(packageDescription)}</strong>
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

    modalFooter.innerHTML = `
      <button
        type="button"
        class="rider-modal-close-btn"
        onclick="closeOrderDetailsModal()"
      >
        Close
      </button>
      ${renderLifecycleActions(delivery)}
    `;

  }

  modal.hidden = false;
  riderModalReturnFocus = document.activeElement;
  document.body.style.overflow = 'hidden';
  document.getElementById('riderModalCloseBtn')?.focus();

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
    modal.querySelectorAll('.rider-proof-form').forEach(form => form.reset());
    document.getElementById('riderModalBody')?.replaceChildren();
    document.getElementById('riderModalFooter')?.replaceChildren();
    document.body.style.overflow = '';
    if (riderModalReturnFocus?.isConnected) riderModalReturnFocus.focus();
    riderModalReturnFocus = null;
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
        if (event.key === 'Tab') {
          const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')];
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
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
        ".rider-delivery-action-btn, .rider-delivery-decline-btn"
      );

    if (!button) {
      return;
    }

    const orderId = button.dataset.orderId;
    const action = button.dataset.action;

    if (!orderId || !action) {
      return;
    }

    if (action === "advance" && !button.dataset.nextStatus) {
      return;
    }

    button.disabled = true;
    riderActionInFlight = true;

    try {

      if (action === "accept") {
        await respondToAssignment(orderId, true);
      } else if (action === "decline") {
        const reason = window.prompt("Reason for declining (optional):");
        if (reason === null) return;
        await respondToAssignment(orderId, false, reason);
      } else if (action === "advance") {
        await updateRiderDeliveryStatus(orderId, button.dataset.nextStatus, button);
      }

    } catch (error) {

      console.error(
        "Failed to update delivery:",
        error
      );

      alert(
        error.message ||
        "Failed to update delivery status."
      );

    } finally {
      riderActionInFlight = false;
      button.disabled = false;
    }

  }
);

/* =====================================================
   PROOF OF DELIVERY SUBMISSION
===================================================== */

document.addEventListener(
  "submit",
  async (event) => {

    const form = event.target.closest(".rider-proof-form");

    if (!form) {
      return;
    }

    event.preventDefault();

    const orderId = form.dataset.orderId;
    const recipientName = form.querySelector(".rider-proof-recipient")?.value || "";
    const photoFile = riderCameraPhotos.get(form)?.file || form.querySelector(".rider-proof-photo")?.files?.[0] || null;
    const submitButton = form.querySelector("button[type=submit]");
    if (!form.reportValidity()) return;
    riderActionInFlight = true;

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Submitting...";
    }

    try {

      let gps;
      if (form.dataset.requireGps === 'true') {
        if (!navigator.geolocation) throw new Error('Location is unavailable on this device.');
        const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 15000 }));
        gps = { lat: position.coords.latitude, lng: position.coords.longitude };
      }
      await completeDeliveryWithProof(orderId, recipientName, photoFile, {
        otp: form.querySelector('.rider-proof-otp')?.value.trim(),
        signatureFile: form.querySelector('.rider-proof-signature')?.files?.[0], gps
      });
      form.reset();
      await loadRiderDelivery();

    } catch (error) {

      console.error(
        "Failed to complete delivery:",
        error
      );

      alert(
        error.message ||
        "Failed to complete delivery."
      );

      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Complete Delivery";
      }

    } finally {
      riderActionInFlight = false;
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
        await riderFetch(
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

async function loadRiderNotifications() {
  const container = document.getElementById('riderNotifications');
  if (!container) return;
  try {
    const response = await riderFetch('/api/rider/notifications', { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load notifications.');
    container.innerHTML = (data.notifications || []).map(item => `
      <article class="rider-notification-item">
        <h3>${escapeRiderHtml(item.title || 'Delivery update')}</h3>
        <p>${escapeRiderHtml(item.message)}</p>
        <small>${escapeRiderHtml(item.createdAt ? new Date(item.createdAt).toLocaleString('en-GB') : '')}</small>
      </article>
    `).join('') || '<div class="rider-empty-state"><p>No notifications yet.</p></div>';
  } catch (error) {
    container.textContent = error.message || 'Unable to load notifications.';
  }
}

if (riderParams.get('expired')) riderLoginMessage.textContent = 'Your session has expired. Please sign in again.';
initializeRiderPage();
