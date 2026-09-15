/* =========================================================
   FIABLE ADMIN PORTAL
========================================================= */

function toast(message) {

  const existingToast =
    document.getElementById("adminToast");

  if (existingToast) {
    existingToast.remove();
  }

  const toastElement =
    document.createElement("div");

  toastElement.id = "adminToast";

  toastElement.textContent = message;

  toastElement.style.position = "fixed";
  toastElement.style.top = "24px";
  toastElement.style.right = "24px";
  toastElement.style.zIndex = "99999";
  toastElement.style.padding = "14px 20px";
  toastElement.style.borderRadius = "10px";
  toastElement.style.background = "#166534";
  toastElement.style.color = "#ffffff";
  toastElement.style.fontSize = "14px";
  toastElement.style.fontWeight = "600";
  toastElement.style.boxShadow =
    "0 8px 24px rgba(0, 0, 0, 0.15)";

  document.body.appendChild(
    toastElement
  );

  setTimeout(() => {
    toastElement.remove();
  }, 3000);
}
window.addEventListener("pageshow", async () => {

  try {

    const response = await fetch("/api/admin/summary", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store"
    });

    if (response.status === 401) {
      window.location.replace("/admin-login.html");
    }

  } catch (error) {

    console.error("ADMIN SESSION CHECK ERROR:", error);

  }

});

document.addEventListener("DOMContentLoaded", async () => {

  let adminOrders = [];
  const selectedOrderIds = new Set();

  const PLAN_PRICES = {
    Basic: 67500,
    Growth: 105000,
    Business: 143000
  };

  let currentAdmin = null;

  try {

    const response = await fetch("/api/admin/account", {
      credentials: "same-origin",
      cache: "no-store"
    });

    const accountData = await response.json().catch(() => ({}));

    if (!response.ok) {
      window.location.replace("/admin-login.html");
      return;
    }

    currentAdmin = accountData;
    window.currentAdmin = accountData;

    document.body.classList.remove("admin-page-loading");

  } catch (error) {

    console.error("ADMIN AUTH CHECK ERROR:", error);

    window.location.replace("/admin-login.html");
    return;

  }

  /* =======================================================
     ELEMENTS
  ======================================================= */

  const sidebar = document.getElementById("adminSidebar");
  const menuToggle = document.getElementById("adminMenuToggle");
  const closeSidebar = document.getElementById("closeAdminSidebar");
  const logoutBtn = document.getElementById("adminLogoutBtn");

  const navItems = document.querySelectorAll("[data-admin-view]");
  const views = document.querySelectorAll(".view");

  const viewTargetButtons = document.querySelectorAll(
    "[data-admin-view-target]"
  );


  /* =======================================================
     API HELPER
  ======================================================= */

  async function api(url, options = {}) {

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });

    const text = await response.text();

    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error("The server returned an invalid response.");
    }

    if (!response.ok) {
      throw new Error(data.error || "Something went wrong.");
    }

    return data;
  }

  /* =======================================================
     HARD PASSWORD-CHANGE GATE
     While mustChangePassword is true, only the Settings view
     (where the change-password form lives) is reachable - the
     backend enforces this too, this just matches the UI to it.
  ======================================================= */

  function passwordChangeRequired() {
    return Boolean(currentAdmin && currentAdmin.mustChangePassword);
  }

  const ORDER_STATUS_META = {
    requested: ["Pending", "status-requested"],
    assigned: ["Assigned", "status-assigned"],
    rider_accepted: ["Rider Accepted", "status-assigned"],
    arriving_at_pickup: ["Arriving at Pickup", "status-assigned"],
    picked_up: ["Picked Up", "status-assigned"],
    on_delivery: ["In Transit", "status-on-delivery"],
    delivered: ["Delivered", "status-delivered"],
    failed: ["Failed", "status-failed"],
    cancelled: ["Cancelled", "status-cancelled"],
    returned: ["Returned", "status-failed"],
  };

  function getOrderStatusMeta(status) {
    const [label, className] = ORDER_STATUS_META[status] || [status || "—", ""];
    return { label, className };
  }

  function renderOrderTimeline(timeline) {
    if (!Array.isArray(timeline) || !timeline.length) {
      return '<p class="empty-state">No timeline history is available for this order.</p>';
    }
    const exceptionStatuses = new Set(["failed", "cancelled", "returned"]);
    return `<ul class="order-timeline">${timeline.map(event => {
      const meta = getOrderStatusMeta(event.status);
      const at = event.at ? new Date(event.at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
      const actor = event.actorName || (event.actorType ? event.actorType.charAt(0).toUpperCase() + event.actorType.slice(1) : "System");
      return `
        <li class="${exceptionStatuses.has(event.status) ? "exception" : ""}">
          <span class="timeline-status">${meta.label}</span>
          <span class="timeline-meta">${at} · ${actor}${event.note ? ` · ${event.note}` : ""}</span>
        </li>
      `;
    }).join("")}</ul>`;
  }

  function renderProofOfDelivery(order) {
    const proof = order.proofOfDelivery;
    if (!proof) {
      return '<p class="empty-state">No proof of delivery has been captured yet.</p>';
    }
    const otpBadge = order.otpState
      ? `<span class="otp-state-badge ${order.otpState}">${order.otpState.replace(/_/g, " ")}</span>`
      : "";
    return `
      <div class="proof-of-delivery-grid">
        <div class="vendor-detail-item">
          <span>Recipient Name</span>
          <strong>${proof.recipientName || "—"}</strong>
        </div>
        <div class="vendor-detail-item">
          <span>Delivered At</span>
          <strong>${proof.deliveredAt ? new Date(proof.deliveredAt).toLocaleString("en-GB") : "—"}</strong>
        </div>
        <div class="vendor-detail-item">
          <span>OTP Verification</span>
          <strong>${otpBadge || "Not required"}</strong>
        </div>
        <div class="vendor-detail-item">
          <span>GPS Location</span>
          <strong>${proof.gps ? `${proof.gps.lat}, ${proof.gps.lng}` : "Not captured"}</strong>
        </div>
        ${proof.photoPath ? `<div class="vendor-detail-item"><span>Delivery Photo</span><img class="proof-of-delivery-photo" src="/api/proof/${proof.photoPath}" alt="Delivery photo"></div>` : ""}
        ${proof.signaturePath ? `<div class="vendor-detail-item"><span>Signature</span><img class="proof-of-delivery-photo" src="/api/proof/${proof.signaturePath}" alt="Recipient signature"></div>` : ""}
      </div>
    `;
  }

  function showPasswordGateBanner() {
    if (document.getElementById("passwordGateBanner")) return;
    const banner = document.createElement("div");
    banner.id = "passwordGateBanner";
    banner.style.cssText = "position:fixed;inset-block-start:0;inset-inline-start:0;inset-inline-end:0;z-index:99998;background:#b45309;color:#fff;padding:12px 20px;font-size:14px;font-weight:600;text-align:center";
    banner.textContent = "You're using a temporary password. Change it below to unlock the rest of the admin portal.";
    document.body.prepend(banner);
  }

  /* =======================================================
     ROLE-AWARE NAVIGATION (UX only - backend is authoritative)
  ======================================================= */

  const NAV_VIEW_PERMISSIONS = {
    "admin-vendors": "view_vendors",
    "admin-orders": "view_orders",
    "admin-subscriptions": "view_finance",
    "admin-riders": "view_riders",
    "admin-team": "view_team",
    "admin-tickets": "view_tickets",
    "admin-audit-log": "view_audit_log",
    "admin-reports": "export_data",
  };

  function applyRoleAwareNavigation() {
    if (!currentAdmin) return;
    const permissions = new Set(currentAdmin.permissions || []);
    const hasAll = permissions.has("*");
    navItems.forEach(item => {
      const required = NAV_VIEW_PERMISSIONS[item.dataset.adminView];
      const allowed = !required || hasAll || permissions.has(required);
      item.classList.toggle("nav-item-hidden", !allowed);
    });
  }

  /* =======================================================
     VIEW SWITCHING
  ======================================================= */

  function showAdminView(viewName) {

    if (passwordChangeRequired() && viewName !== "admin-settings") {
      showAdminToast("Change your temporary password before continuing.", "error");
      viewName = "admin-settings";
    }

    views.forEach(view => {
      view.classList.remove("active");
    });

    const targetView = document.getElementById(
      `view-${viewName}`
    );

    if (!targetView) {
      console.warn(`Admin view not found: ${viewName}`);
      return;
    }

    targetView.classList.add("active");

    navItems.forEach(item => {

      item.classList.toggle(
        "active",
        item.dataset.adminView === viewName
      );

    });

    if (window.innerWidth <= 700 && sidebar) {
      sidebar.classList.remove("open");
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }


  /* =======================================================
     SIDEBAR NAVIGATION
  ======================================================= */

  navItems.forEach(item => {

    item.addEventListener("click", () => {

      const viewName = item.dataset.adminView;

      if (!viewName) return;

      showAdminView(viewName);

      if (viewName === "admin-vendors") {
        loadAdminVendors();
      }
      if (viewName === "admin-tickets") {
        loadAdminTickets();
      }
      if (viewName === "admin-audit-log") {
        auditCurrentPage = 1;
        loadAdminAuditLog();
      }

    });

  });


  /* =======================================================
     DASHBOARD INTERNAL NAVIGATION
  ======================================================= */

  viewTargetButtons.forEach(button => {

    button.addEventListener("click", () => {

      const viewName = button.dataset.adminViewTarget;

      if (!viewName) return;

      showAdminView(viewName);

    });

  });


  /* =======================================================
     MOBILE SIDEBAR
  ======================================================= */

  if (menuToggle && sidebar) {

    menuToggle.addEventListener("click", () => {
      sidebar.classList.add("open");
    });

  }


  if (closeSidebar && sidebar) {

    closeSidebar.addEventListener("click", () => {
      sidebar.classList.remove("open");
    });

  }


  document.addEventListener("click", event => {

    if (
      window.innerWidth <= 700 &&
      sidebar &&
      sidebar.classList.contains("open")
    ) {

      const clickedInsideSidebar =
        sidebar.contains(event.target);

      const clickedMenuButton =
        menuToggle?.contains(event.target);

      if (
        !clickedInsideSidebar &&
        !clickedMenuButton
      ) {
        sidebar.classList.remove("open");
      }

    }

  });


 /* =======================================================
   LOGOUT
======================================================= */

if (logoutBtn) {

  logoutBtn.addEventListener("click", async () => {

    try {

      await fetch("/api/admin/logout", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        credentials: "same-origin",
        body: JSON.stringify({})
    });

    } catch (error) {

      console.error("ADMIN LOGOUT ERROR:", error);

    } finally {

      window.location.href = "/admin-login.html";

    }

  });

}


  /* =======================================================
     LOAD ADMIN DASHBOARD
  ======================================================= */

  async function loadAdminDashboard() {

    try {

      const summary = await api("/api/admin/summary");

      console.log("ADMIN SUMMARY:", summary);


      /* -----------------------------------------------------
         VENDORS
      ----------------------------------------------------- */

      const totalVendors =
        document.getElementById("adminTotalVendors");

      if (totalVendors) {
        totalVendors.textContent =
          summary.vendors?.total ?? 0;
      }


      /* -----------------------------------------------------
         SUBSCRIPTIONS
      ----------------------------------------------------- */

      const activeSubscribers =
        document.getElementById(
          "adminActiveSubscribers"
        );

      if (activeSubscribers) {
        activeSubscribers.textContent =
          summary.subscriptions?.active ?? 0;
      }


      /* -----------------------------------------------------
         ORDERS
      ----------------------------------------------------- */

      const totalOrders =
        document.getElementById("adminTotalOrders");

      if (totalOrders) {
        totalOrders.textContent =
          summary.orders?.total ?? 0;
      }


      /* -----------------------------------------------------
         PENDING DELIVERIES
         requested = pending
      ----------------------------------------------------- */

      const pendingDeliveries =
        document.getElementById(
          "adminPendingDeliveries"
        );

      if (pendingDeliveries) {
        pendingDeliveries.textContent =
          summary.orders?.requested ?? 0;
      }

      const assignedDeliveries =
        document.getElementById(
          "adminAssignedDeliveries"
        );

      if (assignedDeliveries) {
        assignedDeliveries.textContent =
          summary.orders?.assigned ?? 0;
      }

      /* -----------------------------------------------------
         On DELIVERIES
         on_delivery = on delivery
      ----------------------------------------------------- */

      const onDelivery =
        document.getElementById(
          "adminOnDelivery"
        );

      if (onDelivery) {
        onDelivery.textContent =
          summary.orders?.on_delivery ?? 0;
      }


      /* -----------------------------------------------------
         COMPLETED DELIVERIES
         delivered = completed
      ----------------------------------------------------- */

      const completedDeliveries =
        document.getElementById(
          "adminCompletedDeliveries"
        );

      if (completedDeliveries) {
        completedDeliveries.textContent =
          summary.orders?.delivered ?? 0;
      }


      /* -----------------------------------------------------
         FAILED DELIVERIES
         failed = failed
      ----------------------------------------------------- */

      const failedDeliveries =
        document.getElementById(
          "adminFailedDeliveries"
        );

      if (failedDeliveries) {
        failedDeliveries.textContent =
          summary.orders?.failed ?? 0;
      }

      /* -----------------------------------------------------
         Cancelled DELIVERIES
         cancelled = canceled
      ----------------------------------------------------- */

      const cancelledDeliveries =
        document.getElementById(
          "adminCancelledDeliveries"
        );

      if (cancelledDeliveries) {
        cancelledDeliveries.textContent =
          summary.orders?.cancelled ?? 0;
      }


    } catch (error) {

      console.error(
        "ADMIN DASHBOARD ERROR:",
        error
      );

    }

  }

  async function loadAdminSettings() {

    try {

      const response = await fetch(
        "/api/admin/account",
        {
          credentials: "same-origin",
          cache: "no-store"
        }
      );

      const data =
        await response.json();

      if (!response.ok) {

        throw new Error(
          data.error ||
          "Unable to load admin account."
        );

      }


      /* ---------------------------------------------
        ADMIN NAME
      --------------------------------------------- */

      const settingsName =
        document.getElementById("settingsName");

      if (settingsName) {

        settingsName.textContent =
          data.name || "Administrator";

      }


      /* ---------------------------------------------
        ADMIN EMAIL
      --------------------------------------------- */

      const settingsEmail =
        document.getElementById("settingsEmail");

      if (settingsEmail) {

        settingsEmail.textContent =
          data.email || "—";

      }


      /* ---------------------------------------------
        ADMIN ROLE
      --------------------------------------------- */

      const settingsRole =
        document.getElementById("settingsRole");

      if (settingsRole) {

        settingsRole.textContent =
          "Administrator";

      }


      /* ---------------------------------------------
        ACCOUNT STATUS
      --------------------------------------------- */

      const settingsStatus =
        document.getElementById("settingsStatus");

      if (settingsStatus) {

        settingsStatus.textContent =
          "Active";

      }


    } catch (error) {

      console.error(
        "ADMIN SETTINGS ERROR:",
        error
      );

    }

  }

  const addAdminModal = document.getElementById("addAdminModal");
  const addAdminForm = document.getElementById("addAdminForm");
  const addAdminBtn = document.getElementById("addAdminBtn");
  const addAdminMessage = document.getElementById("addAdminMessage");

  function closeAddAdminModal() {
    addAdminModal?.classList.remove("show");
    addAdminModal?.setAttribute("aria-hidden", "true");
  }

  function openAddAdminModal() {
    addAdminMessage.textContent = "";
    addAdminForm?.reset();
    addAdminModal?.classList.add("show");
    addAdminModal?.setAttribute("aria-hidden", "false");
  }

  async function teamRequest(url, body) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to update team.");
    return data;
  }

  const ADMIN_ROLE_LABELS = {
    super_admin: "Super Admin", operations_manager: "Operations Manager",
    dispatcher: "Dispatcher", finance: "Finance",
    customer_support: "Customer Support", analyst: "Analyst (Read Only)",
    owner: "Super Admin", staff: "Operations Manager",
  };
  const ADMIN_ASSIGNABLE_ROLES = [
    ["super_admin", "Super Admin"], ["operations_manager", "Operations Manager"],
    ["dispatcher", "Dispatcher"], ["finance", "Finance"],
    ["customer_support", "Customer Support"], ["analyst", "Analyst (Read Only)"],
  ];

  async function loadAdminTeam() {
    const tableBody = document.getElementById("adminTeamBody");
    if (!tableBody) return;

    try {
      const response = await fetch("/api/admin/team", {
        credentials: "same-origin",
        cache: "no-store"
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load team.");

      addAdminBtn.disabled = !data.isOwner;
      const admins = data.admins || [];
      tableBody.innerHTML = admins.length ? admins.map(admin => {
        const isCurrent = admin.email.toLowerCase() === (data.currentAdminEmail || "").toLowerCase();
        const isProtectedOwner = admin.role === "owner" || admin.role === "super_admin";
        const canManage = data.isOwner && !isCurrent && !isProtectedOwner;
        const roleControl = isProtectedOwner
          ? (admin.roleLabel || ADMIN_ROLE_LABELS[admin.role] || admin.role)
          : `<select class="admin-team-role" data-email="${escapeSubscriptionValue(admin.email)}" ${canManage ? "" : "disabled"}>${ADMIN_ASSIGNABLE_ROLES.map(([value, label]) => `<option value="${value}" ${admin.role === value ? "selected" : ""}>${label}</option>`).join("")}</select>`;
        const badges = [
          admin.mustChangePassword ? '<span class="admin-team-status revoked" title="Must change password before using the dashboard">Temp password</span>' : "",
          admin.mfaEnabled ? '<span class="admin-team-status active">MFA on</span>' : "",
        ].join(" ");
        return `
          <tr>
            <td><strong>${escapeSubscriptionValue(admin.email || "—")}</strong><div class="muted" style="font-size:12px">${escapeSubscriptionValue(admin.name || "")}</div></td>
            <td><span class="admin-team-role-value">${roleControl}</span></td>
            <td><span class="admin-team-status ${admin.status}">${escapeSubscriptionValue(admin.status)}</span> ${badges}</td>
            <td>${admin.createdAt ? new Date(admin.createdAt).toLocaleDateString("en-GB") : "—"}</td>
            <td>${canManage ? `<button type="button" class="btn outline admin-team-access" data-email="${escapeSubscriptionValue(admin.email)}" data-action="${admin.status === "revoked" ? "restore" : "revoke"}">${admin.status === "revoked" ? "Restore access" : "Revoke access"}</button><button type="button" class="btn danger admin-team-delete" data-email="${escapeSubscriptionValue(admin.email)}">Delete</button>` : isCurrent ? "You cannot change your own access." : "Protected"}</td>
          </tr>
        `;
      }).join("") : '<tr><td colspan="5" class="empty-state">No administrators found.</td></tr>';

      tableBody.querySelectorAll(".admin-team-role").forEach(select => {
        select.addEventListener("change", async () => {
          try {
            await teamRequest("/api/admin/team/role", { email: select.dataset.email, role: select.value });
            showAdminToast("Role updated successfully.");
            loadAdminTeam();
          } catch (error) {
            showAdminToast(error.message, "error");
            loadAdminTeam();
          }
        });
      });


      tableBody.querySelectorAll(".admin-team-access").forEach(button => {
        button.addEventListener("click", async () => {
          try {
            await teamRequest(`/api/admin/team/${button.dataset.action}`, { email: button.dataset.email });
            showAdminToast("Team access updated.");
            loadAdminTeam();
          } catch (error) {
            showAdminToast(error.message, "error");
          }
        });
      });

      tableBody.querySelectorAll(".admin-team-delete").forEach(button => {
        button.addEventListener("click", async () => {
          if (!window.confirm("Remove this admin from the team?")) return;
          try {
            await teamRequest("/api/admin/team/delete", { email: button.dataset.email });
            showAdminToast("Admin removed.");
            loadAdminTeam();
          } catch (error) {
            showAdminToast(error.message, "error");
          }
        });
      });
    } catch (error) {
      tableBody.innerHTML = `<tr><td colspan="5" class="empty-state">${escapeSubscriptionValue(error.message)}</td></tr>`;
    }
  }

  addAdminBtn?.addEventListener("click", openAddAdminModal);
  document.getElementById("closeAddAdmin")?.addEventListener("click", closeAddAdminModal);
  document.getElementById("addAdminBackdrop")?.addEventListener("click", closeAddAdminModal);
  addAdminForm?.addEventListener("submit", async event => {
    event.preventDefault();
    addAdminMessage.textContent = "";
    try {
      const data = await teamRequest("/api/admin/team/add", {
        name: document.getElementById("newAdminName").value.trim(),
        email: document.getElementById("newAdminEmail").value.trim(),
        password: document.getElementById("newAdminPassword").value,
        role: document.getElementById("newAdminRole").value
      });
      closeAddAdminModal();
      await loadAdminTeam();
      showAdminToast("Admin added successfully.");
    } catch (error) {
      addAdminMessage.textContent = error.message;
    }
  });

  async function loadAdminVendors() {

    const tableBody = document.getElementById("adminVendorsBody");

    if (!tableBody) return;

    try {

      const response = await fetch("/api/admin/summary", {
        credentials: "same-origin"
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Unable to load vendors."
        );
      }

      const vendors = data.vendors?.items || [];


      if (!vendors.length) {

        tableBody.innerHTML = `
          <tr>
            <td colspan="8" class="empty-state">
              No vendors found.
            </td>
          </tr>
        `;

        return;
      }


      tableBody.innerHTML = vendors.map((vendor, index) => {

        const renewalDate = vendor.renewalDate
          ? new Date(vendor.renewalDate).toLocaleDateString(
              "en-GB",
              {
                day: "2-digit",
                month: "short",
                year: "numeric"
              }
            )
          : "—";


        const statusLabel =
          vendor.subscriptionState === "expiring_soon"
            ? "Expiring Soon"
            : vendor.subscriptionState === "pending_payment"
              ? "Pending Payment"
              : vendor.subscriptionState === "grace_period"
                ? "Grace Period"
                : vendor.subscriptionState === "no_plan"
                  ? "No Plan"
                  : vendor.subscriptionState === "active"
                    ? "Active"
                    : vendor.subscriptionState === "expired"
                      ? "Expired"
                      : vendor.subscriptionState;


        const orderCount =
          vendor.deliveryStats?.total ?? 0;


        return `
          <tr>

            <!-- Number -->
            <td>
              ${index + 1}
            </td>

            <!-- Vendor -->
            <td>
              <strong>${vendor.name}</strong>
            </td>


            <!-- Subscriber ID -->
            <td>
              ${vendor.subscriberId || "—"}
            </td>


            <!-- Plan -->
            <td>
              ${vendor.plan || "—"}
            </td>


            <!-- Units -->
            <td>
              ${vendor.unitsUsed} / ${vendor.unitsAllocated}
            </td>


            <!-- Subscription -->
            <td>
              ${renewalDate}
            </td>


            <!-- Orders -->
            <td>
              ${orderCount}
            </td>


            <!-- Status -->
            <td>
              <span class="vendor-status">
                ${statusLabel}
              </span>
            </td>


            <!-- Action -->
            <td>
              <button
                type="button"
                class="btn outline vendor-view-btn"
                data-vendor-email="${vendor.email}"
              >
                View
              </button>
            </td>

          </tr>
        `;

      }).join("");

      document
        .querySelectorAll(".vendor-view-btn")
        .forEach(button => {

          button.addEventListener("click", () => {

            const email =
              button.dataset.vendorEmail;

            const vendor =
              vendors.find(item =>
                item.email === email
              );

            if (!vendor) {
              return;
            }

            openVendorDetails(vendor);

          });

        });


    } catch (error) {

      console.error(
        "ADMIN VENDORS ERROR:",
        error
      );

      tableBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-state">
            Unable to load vendors.
          </td>
        </tr>
      `;

    }

  }

  async function loadAdminSubscriptions() {

    const tableBody =
      document.getElementById("adminSubscriptionsBody");

    if (!tableBody) return;

    try {

      const response = await fetch(
        "/api/admin/summary",
        {
          credentials: "same-origin"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Unable to load subscriptions."
        );
      }

      const vendors =
        data.vendors?.items || [];


      if (!vendors.length) {

        tableBody.innerHTML = `
          <tr>
            <td colspan="8" class="empty-state">
              No subscriptions found.
            </td>
          </tr>
        `;

        return;
      }

      const totalSubscriptions =
        vendors.length;

      const activeSubscriptions =
        vendors.filter(
          vendor =>
            vendor.subscriptionState === "active"
        ).length;

      const pendingSubscriptions =
        vendors.filter(
          vendor =>
            vendor.subscriptionState === "pending_payment"
        ).length;

      const expiringSubscriptions =
        vendors.filter(
          vendor =>
            vendor.subscriptionState === "expiring_soon"
        ).length;

      document.getElementById(
        "subscriptionTotal"
      ).textContent = totalSubscriptions;

      document.getElementById(
        "subscriptionActive"
      ).textContent = activeSubscriptions;

      document.getElementById(
        "subscriptionPending"
      ).textContent = pendingSubscriptions;

      document.getElementById(
        "subscriptionExpiring"
      ).textContent = expiringSubscriptions;

      tableBody.innerHTML = vendors.map(
        (vendor, index) => {

          const amount =
            PLAN_PRICES[vendor.plan] ?? 0;


          const paymentDate =
            vendor.paidAt
              ? new Date(
                  vendor.paidAt
                ).toLocaleDateString(
                  "en-GB",
                  {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                  }
                )
              : "—";


          const renewalDate =
            vendor.renewalDate
              ? new Date(
                  vendor.renewalDate
                ).toLocaleDateString(
                  "en-GB",
                  {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                  }
                )
              : "—";


          const statusLabel =
            vendor.subscriptionState === "expiring_soon"
              ? "Expiring Soon"
              : vendor.subscriptionState === "pending_payment"
                ? "Pending Payment"
                : vendor.subscriptionState === "grace_period"
                  ? "Grace Period"
                  : vendor.subscriptionState === "no_plan"
                    ? "No Plan"
                    : vendor.subscriptionState === "active"
                      ? "Active"
                      : vendor.subscriptionState === "expired"
                        ? "Expired"
                        : vendor.subscriptionState || "—";


          return `
            <tr>

              <!-- Number -->
              <td>
                ${index + 1}
              </td>


              <!-- Vendor -->
              <td>
                <strong>
                  ${vendor.name || "—"}
                </strong>
              </td>


              <!-- Plan -->
              <td>
                ${vendor.plan || "—"}
              </td>


              <!-- Amount -->
              <td>
                ₦${amount.toLocaleString("en-NG")}
              </td>


              <!-- Payment Date -->
              <td>
                ${paymentDate}
              </td>


              <!-- Renewal Date -->
              <td>
                ${renewalDate}
              </td>


              <!-- Payment Status -->
              <td>
                <span class="vendor-status">
                  ${statusLabel}
                </span>
              </td>


              <!-- Action -->
              <td>
                <button
                  type="button"
                  class="btn outline subscription-view-btn"
                  data-vendor-email="${vendor.email}"
                >
                  View
                </button>
              </td>

            </tr>
          `;

        }
      ).join("");

      document
        .querySelectorAll(".subscription-view-btn")
        .forEach(button => {

          button.addEventListener(
            "click",
            () => {

              const email =
                button.dataset.vendorEmail;

              const vendor =
                vendors.find(
                  item => item.email === email
                );

              if (!vendor) {
                return;
              }

              openSubscriptionDetails(vendor);

            }
          );

        });

      loadAdminSubscriptionHistory();


    } catch (error) {

      console.error(
        "ADMIN SUBSCRIPTIONS ERROR:",
        error
      );

      tableBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-state">
            Unable to load subscriptions.
          </td>
        </tr>
      `;

    }

  }

  function escapeSubscriptionValue(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    }[character]));
  }

  async function loadAdminSubscriptionHistory() {
    const tableBody = document.getElementById("adminSubscriptionHistoryBody");
    const monthFilter = document.getElementById("adminSubscriptionMonthFilter");
    if (!tableBody) return;
    try {
      const response = await fetch("/api/admin/subscriptions", {
        credentials: "same-origin",
        cache: "no-store"
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load subscription history.");
      const records = data.subscriptions || [];
      const revenueSummary = data.revenueSummary || { monthly: {}, yearly: { revenue: 0, riderPayments: 0, profit: 0 } };
      const monthKey = record => {
        const date = new Date(record.periodStart);
        return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString().slice(0, 7);
      };
      const monthLabel = key => {
        if (key === "unknown") return "Unknown period";
        const date = new Date(`${key}-01T00:00:00Z`);
        return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
      };
      const months = [...new Set(records.map(monthKey))].sort().reverse();
      const revenueMonthFilter = document.getElementById("adminRevenueMonthFilter");
      if (revenueMonthFilter) {
        const selectedRevenueMonth = revenueMonthFilter.value || "current";
        revenueMonthFilter.innerHTML = '<option value="current">Current month</option>' + months.map(month => `<option value="${month}">${monthLabel(month)}</option>`).join("");
        revenueMonthFilter.value =
          selectedRevenueMonth === "current" ||
          months.includes(selectedRevenueMonth)
            ? selectedRevenueMonth
            : "current";
        revenueMonthFilter.onchange = () => renderSubscriptionRevenue(records, revenueMonthFilter.value, revenueSummary);
      }
      renderSubscriptionRevenue(records, revenueMonthFilter?.value || "current", revenueSummary);
      if (monthFilter) {
        const selectedHistoryMonth = monthFilter.value || "all";
        monthFilter.innerHTML = '<option value="all">All months</option>' + months.map(month => `<option value="${month}">${monthLabel(month)}</option>`).join("");
        monthFilter.value =
          selectedHistoryMonth === "all" ||
          months.includes(selectedHistoryMonth)
            ? selectedHistoryMonth
            : "all";
        monthFilter.onchange = () => renderAdminSubscriptionHistory(records, monthFilter.value, tableBody);
      }
      renderAdminSubscriptionHistory(records, monthFilter?.value || "all", tableBody);
    } catch (error) {
      tableBody.innerHTML = `<tr><td colspan="7" class="empty-state">${escapeSubscriptionValue(error.message)}</td></tr>`;
    }
  }

  function renderSubscriptionRevenue(records, selectedMonth = "current", revenueSummary = { monthly: {}, yearly: { revenue: 0, riderPayments: 0, profit: 0 } }) {
    const yearRevenue = document.getElementById("subscriptionYearRevenue");
    const monthRevenue = document.getElementById("subscriptionRevenueByMonth");
    if (!yearRevenue || !monthRevenue) return;

    const paidRecords = records.filter(record => record.paymentStatus === "paid");
    const monthlyTotals = {};
    paidRecords.forEach(record => {
      const date = new Date(record.periodStart || record.paidAt);
      if (Number.isNaN(date.getTime())) return;
      const key = date.toISOString().slice(0, 7);
      monthlyTotals[key] = (monthlyTotals[key] || 0) + Number(record.amount || 0);
    });

    const currentYear = String(new Date().getUTCFullYear());
    const yearlyTotal = Object.entries(monthlyTotals)
      .filter(([month]) => month.startsWith(`${currentYear}-`))
      .reduce((total, [, amount]) => total + amount, 0);
    const yearly = revenueSummary.yearly || { revenue: yearlyTotal, riderPayments: 0, profit: yearlyTotal };
    yearRevenue.textContent = `₦${yearly.revenue.toLocaleString("en-NG")}`;
    document.getElementById("subscriptionYearRiderPayments").textContent = `₦${yearly.riderPayments.toLocaleString("en-NG")}`;
    document.getElementById("subscriptionYearProfit").textContent = `₦${yearly.profit.toLocaleString("en-NG")}`;

    const currentMonth = new Date().toISOString().slice(0, 7);
    const displayedMonth = selectedMonth === "current" ? currentMonth : selectedMonth;
    const selectedTotals = revenueSummary.monthly?.[displayedMonth] || { revenue: 0, riderPayments: 0, profit: 0 };
    const currentMonthTotal = selectedTotals.revenue;
    const monthlyRevenueCard = document.getElementById("subscriptionRevenue");
    if (monthlyRevenueCard) {
      monthlyRevenueCard.textContent = `₦${currentMonthTotal.toLocaleString("en-NG")}`;
    }
    const monthlyRevenueLabel = document.querySelector("#subscriptionRevenue")?.previousElementSibling;
    if (monthlyRevenueLabel) {
      monthlyRevenueLabel.textContent = displayedMonth === currentMonth
        ? "Monthly Revenue"
        : `${new Date(`${displayedMonth}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long" })} Revenue`;
    }
    document.getElementById("selectedMonthRevenue").textContent = `₦${selectedTotals.revenue.toLocaleString("en-NG")}`;
    document.getElementById("selectedMonthRiderPayments").textContent = `₦${selectedTotals.riderPayments.toLocaleString("en-NG")}`;
    document.getElementById("selectedMonthProfit").textContent = `₦${selectedTotals.profit.toLocaleString("en-NG")}`;
    const months = Object.entries(monthlyTotals).sort(([a], [b]) => b.localeCompare(a));
    monthRevenue.innerHTML = months.length ? months.map(([month, amount]) => {
      const date = new Date(`${month}-01T00:00:00Z`);
      const label = date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
      const totals = revenueSummary.monthly?.[month] || { revenue: amount, riderPayments: 0, profit: amount };
      return `<div class="subscription-revenue-row"><span>${label}</span><strong>₦${totals.profit.toLocaleString("en-NG")} profit</strong></div>`;
    }).join("") : '<p class="muted">No paid subscription revenue recorded.</p>';
  }

  function renderAdminSubscriptionHistory(records, selectedMonth, tableBody) {
    const visibleRecords = selectedMonth === "all"
      ? records
      : records.filter(record => {
        const date = new Date(record.periodStart);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 7) === selectedMonth;
      });
    tableBody.innerHTML = visibleRecords.length ? visibleRecords.map(record => `
        <tr>
          <td><strong>${escapeSubscriptionValue(record.name || "—")}</strong></td>
          <td>${escapeSubscriptionValue(new Date(record.periodStart).toLocaleDateString("en-GB", { month: "long", year: "numeric" }))}</td>
          <td>${escapeSubscriptionValue(record.plan || "—")}</td>
          <td>${escapeSubscriptionValue(new Date(record.periodStart).toLocaleDateString("en-GB"))} – ${escapeSubscriptionValue(new Date(record.periodEnd).toLocaleDateString("en-GB"))}</td>
          <td>${escapeSubscriptionValue(record.deliveryCount ?? 0)}</td>
          <td>${escapeSubscriptionValue(record.subscriptionStatus === "exhausted" ? "Exhausted" : record.paymentStatus === "paid" ? "Paid" : record.paymentStatus || "—")}</td>
          <td><button type="button" class="btn outline admin-history-view-btn" data-subscription-id="${escapeSubscriptionValue(record.id)}" data-subscription-email="${escapeSubscriptionValue(record.email)}">View</button></td>
        </tr>
      `).join("") : '<tr><td colspan="7" class="empty-state">No subscription history found for this month.</td></tr>';
    tableBody.querySelectorAll(".admin-history-view-btn").forEach(button => {
      button.addEventListener("click", () => openAdminSubscriptionRecord(button.dataset.subscriptionId, button.dataset.subscriptionEmail));
    });
  }

  async function openAdminSubscriptionRecord(subscriptionId, email) {
    try {
      const response = await fetch(`/api/admin/subscriptions/details?subscriptionId=${encodeURIComponent(subscriptionId)}`, { credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load subscription deliveries.");
      const deliveries = data.deliveries || [];
      subscriptionDetailsTitle.textContent = `${email} · ${subscriptionId}`;
      subscriptionDetailsBody.innerHTML = deliveries.length ? `<div class="vendor-detail-grid">${deliveries.map(delivery => `<div class="vendor-detail-item"><span>${escapeSubscriptionValue(delivery.orderRef || `Order #${delivery.id}`)}</span><strong>${escapeSubscriptionValue(delivery.pickup || "—")} → ${escapeSubscriptionValue(delivery.dropoff || "—")} · ${escapeSubscriptionValue(delivery.status || "—")}</strong></div>`).join("")}</div>` : '<p class="muted">No deliveries were recorded during this subscription period.</p>';
      subscriptionDetailsModal.classList.add("show");
      subscriptionDetailsModal.setAttribute("aria-hidden", "false");
    } catch (error) {
      console.error("ADMIN SUBSCRIPTION HISTORY ERROR:", error);
    }
  }

  async function loadAdminRiders() {

    const tableBody =
      document.getElementById("adminRidersBody");

    if (!tableBody) return;

    try {

      const response = await fetch(
        "/api/admin/riders",
        {
          credentials: "same-origin"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Unable to load riders."
        );
      }

      const riders = data.riders || [];

      loadAdminRiderPayments();


      /* =====================================================
        SUMMARY COUNTS
      ===================================================== */

      const totalRiders =
        riders.length;

      const activeRiders =
        riders.filter(
          rider => rider.isLoggedIn
        ).length;

      const availableRiders =
        riders.filter(
          rider => rider.status === "available"
        ).length;

      const assignedRiders =
        riders.filter(
          rider => rider.status === "assigned"
        ).length;

      const onDeliveryRiders =
        riders.filter(
          rider => rider.status === "on_delivery"
        ).length;

      const inactiveRiders =
        riders.filter(
          rider => !rider.isLoggedIn
        ).length;


      document.getElementById(
        "totalRiders"
      ).textContent = totalRiders;

      document.getElementById(
        "activeRiders"
      ).textContent = activeRiders;

      document.getElementById(
        "availableRiders"
      ).textContent = availableRiders;

      document.getElementById(
        "assignedRiders"
      ).textContent = assignedRiders;

      document.getElementById(
        "onDeliveryRiders"
      ).textContent = onDeliveryRiders;

      document.getElementById(
        "inactiveRiders"
      ).textContent = inactiveRiders;


      /* =====================================================
        EMPTY STATE
      ===================================================== */

      if (!riders.length) {

        tableBody.innerHTML = `
          <tr>
            <td
              colspan="8"
              class="empty-state"
            >
              No riders found.
            </td>
          </tr>
        `;

        return;
      }


      /* =====================================================
        RIDER TABLE
      ===================================================== */

      tableBody.innerHTML =
        riders.map((rider, index) => {

          const statusLabel =
            !rider.isLoggedIn
              ? "Inactive"
              : rider.status === "on_delivery"
              ? "On Delivery"
              : rider.status === "available"
                ? "Available"
                : rider.status === "assigned"
                ? "Assigned"
                : rider.status === "active"
                  ? "Active"
                  : rider.status === "inactive"
                    ? "Inactive"
                    : rider.status || "—";


          return `
            <tr>

              <!-- Number -->
              <td>
                ${index + 1}
              </td>


              <!-- Rider -->
              <td>
                <strong>
                  ${rider.name || "—"}
                </strong>
              </td>


              <!-- Rider ID -->
              <td>
                ${rider.riderRef || "—"}
              </td>


              <!-- Phone -->
              <td>
                ${rider.phone || "—"}
              </td>


              <!-- Vehicle -->
              <td>
                ${rider.vehicle || "—"}
              </td>


              <!-- Deliveries -->
              <td>
                ${rider.totalDeliveries ?? 0}
              </td>


              <!-- Status -->
              <td>
                <span class="vendor-status">
                  ${statusLabel}
                </span>
              </td>

              <!-- Action -->
              <td>

                <div class="rider-action-buttons">

                  <button
                    type="button"
                    class="btn outline rider-view-btn"
                    data-rider-id="${rider.id}"
                  >
                    View
                  </button>

                  <button
                    type="button"
                    class="btn primary rider-edit-btn"
                    data-rider-id="${rider.id}"
                  >
                    Edit
                  </button>

                </div>

              </td>

            </tr>
          `;

        }).join("");

      document
        .querySelectorAll(".rider-view-btn")
        .forEach(button => {

          button.addEventListener(
            "click",
            () => {

              const riderId =
                Number(button.dataset.riderId);

              const rider =
                riders.find(
                  item => Number(item.id) === riderId
                );

              if (!rider) {
                return;
              }

              openRiderDetails(rider);

            }
          );

        });

      /* =====================================================
        EDIT RIDER BUTTONS
      ===================================================== */

      document
        .querySelectorAll(".rider-edit-btn")
        .forEach(button => {

          button.addEventListener(
            "click",
            () => {

              const riderId =
                Number(button.dataset.riderId);

              const rider =
                riders.find(
                  item => Number(item.id) === riderId
                );

              if (!rider) {
                return;
              }

              openEditRider(rider);

            }
          );

        });

    } catch (error) {

      console.error(
        "ADMIN RIDERS ERROR:",
        error
      );

      tableBody.innerHTML = `
        <tr>
          <td
            colspan="8"
            class="empty-state"
          >
            Unable to load riders.
          </td>
        </tr>
      `;

    }

  }

  async function loadAdminRiderPayments() {
    const tableBody = document.getElementById("adminRiderPaymentsBody");
    const totalElement = document.getElementById("riderPaymentsTotal");
    const monthFilter = document.getElementById("riderPaymentMonthFilter");
    if (!tableBody) return;
    try {
      const selectedMonth = monthFilter?.value || "all";
      const query = selectedMonth === "all" ? "" : `?month=${encodeURIComponent(selectedMonth)}`;
      const response = await fetch(`/api/admin/rider-payments${query}`, { credentials: "same-origin", cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load rider payments.");
      const payments = data.payments || [];
      if (monthFilter && !monthFilter.dataset.ready) {
        monthFilter.innerHTML = '<option value="all">All months</option>' + (data.months || []).map(month => `<option value="${month}">${new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</option>`).join("");
        monthFilter.dataset.ready = "true";
        monthFilter.addEventListener("change", loadAdminRiderPayments);
      }
      const outstandingTotal = payments.reduce((total, payment) => total + Number(payment.outstanding || 0), 0);
      if (totalElement) totalElement.textContent = `₦${outstandingTotal.toLocaleString("en-NG")} outstanding`;
      tableBody.innerHTML = payments.length ? payments.map(payment => `
        <tr>
          <td><button type="button" class="rider-payment-view-btn" data-rider-payment-id="${payment.riderId}"><strong>${escapeSubscriptionValue(payment.name || "—")}</strong></button></td>
          <td>${escapeSubscriptionValue(payment.riderRef || "—")}</td>
          <td>${payment.completedDeliveries ?? 0}</td>
          <td>${payment.failedDeliveries ?? 0}</td>
          <td>₦${Number(payment.payable || 0).toLocaleString("en-NG")}</td>
          <td>₦${Number(payment.paid || 0).toLocaleString("en-NG")}</td>
          <td><strong>₦${Number(payment.outstanding || 0).toLocaleString("en-NG")}</strong></td>
        </tr>
      `).join("") : '<tr><td colspan="7" class="empty-state">No rider payment records found.</td></tr>';
      tableBody.querySelectorAll(".rider-payment-view-btn").forEach(button => {
        const payment = payments.find(item => String(item.riderId) === button.dataset.riderPaymentId);
        button.addEventListener("click", () => openRiderPaymentBreakdown(payment));
      });
    } catch (error) {
      tableBody.innerHTML = `<tr><td colspan="7" class="empty-state">${escapeSubscriptionValue(error.message)}</td></tr>`;
    }
  }

  function openRiderPaymentBreakdown(payment) {
    if (!payment || !riderDetailsModal || !riderDetailsBody) return;
    riderDetailsTitle.textContent = `${payment.name || "Rider"} payment breakdown`;

    const selectedMonth = document.getElementById("riderPaymentMonthFilter")?.value || "all";
    const monthValue = selectedMonth === "all" ? getCurrentMonth() : selectedMonth;
    const outstandingDeliveries = (payment.breakdown || []).filter(
      delivery => delivery.paymentStatus === "outstanding" ||
        delivery.paymentStatus === "part_paid"
    );
    const paymentStatusLabel = status => ({
      paid: "Paid",
      part_paid: "Part paid",
      outstanding: "Outstanding",
      not_payable: "Not payable"
    })[status] || "Not payable";

    riderDetailsBody.innerHTML = `
      <div class="rider-payment-summary-grid">
        <div><span>Completed deliveries</span><strong>${payment.completedDeliveries}</strong></div>
        <div><span>Total payable</span><strong>₦${Number(payment.payable).toLocaleString("en-NG")}</strong></div>
        <div><span>Already paid</span><strong>₦${Number(payment.paid || 0).toLocaleString("en-NG")}</strong></div>
        <div><span>Outstanding</span><strong>₦${Number(payment.outstanding || 0).toLocaleString("en-NG")}</strong></div>
      </div>
      ${outstandingDeliveries.length ? `<div class="rider-payment-outstanding"><strong>${outstandingDeliveries.length} ${outstandingDeliveries.length === 1 ? "delivery" : "deliveries"} need payment</strong><span>₦${outstandingDeliveries.reduce((total, delivery) => total + Number(delivery.outstandingAmount || 0), 0).toLocaleString("en-NG")} outstanding</span></div>` : ""}
      <h3>Delivery payments</h3>
      ${payment.breakdown?.length ? `<div class="table-wrap"><table class="admin-table"><thead><tr><th>Order</th><th>Route</th><th>Units</th><th>Status</th><th>Rider 80%</th><th>Payment</th></tr></thead><tbody>${payment.breakdown.map(delivery => `
        <tr class="${delivery.paymentStatus === "outstanding" || delivery.paymentStatus === "part_paid" ? "rider-payment-row-outstanding" : ""}"><td>${escapeSubscriptionValue(delivery.orderRef)}</td><td>${escapeSubscriptionValue(delivery.route)}</td><td>${delivery.units}</td><td>${escapeSubscriptionValue(delivery.status || "—")}</td><td>${delivery.payable ? `₦${Number(delivery.riderPayment).toLocaleString("en-NG")}` : "Not payable"}</td><td><span class="rider-payment-status ${escapeSubscriptionValue(delivery.paymentStatus)}">${paymentStatusLabel(delivery.paymentStatus)}${delivery.paymentStatus === "outstanding" || delivery.paymentStatus === "part_paid" ? ` · ₦${Number(delivery.outstandingAmount || 0).toLocaleString("en-NG")}` : ""}</span></td></tr>
      `).join("")}</tbody></table></div>` : '<p class="muted">No deliveries found for this rider.</p>'}
      <div class="rider-payment-actions" style="margin-block-start: 20px;">
        <button type="button" id="markRiderPaymentPaidBtn" class="btn primary">Mark payment as paid</button>
      </div>
    `;
    
    const markPaidBtn = document.getElementById("markRiderPaymentPaidBtn");
    if (markPaidBtn && payment.outstanding > 0) {
      markPaidBtn.addEventListener("click", () => {
        markRiderPaymentAsPaid(payment, monthValue);
      });
    } else if (markPaidBtn) {
      markPaidBtn.disabled = true;
      markPaidBtn.textContent = "No outstanding payment";
    }
    
    riderDetailsModal.classList.add("show");
    riderDetailsModal.setAttribute("aria-hidden", "false");
  }

  function getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  async function markRiderPaymentAsPaid(payment, month) {
    if (!payment.outstanding || payment.outstanding <= 0) {
      alert("No outstanding payment to mark as paid.");
      return;
    }

    const amount = Math.round(payment.outstanding);
    
    if (!confirm(`Mark ₦${amount.toLocaleString("en-NG")} as paid for ${payment.name}?`)) {
      return;
    }

    try {
      const response = await fetch(
        "/api/admin/rider-payments/mark-paid",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            riderId: payment.riderId,
            amount: amount,
            month: month
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to mark payment as paid.");
      }

      toast("Payment recorded successfully.");
      loadAdminRiderPayments();
      riderDetailsModal.classList.remove("show");
      riderDetailsModal.setAttribute("aria-hidden", "true");
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  }


  async function loadAvailableRiders() {

    const selects = [
      document.getElementById("assignRiderSelect"),
      document.getElementById("reassignRiderSelect")
    ].filter(Boolean);

    if (!selects.length) {
      return;
    }

    try {

      const response = await fetch(
        "/api/admin/riders",
        {
          credentials: "same-origin"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Unable to load riders."
        );
      }

      const riders =
        (data.riders || []).filter(
          rider => rider.isLoggedIn && rider.status !== "on_delivery"
        );


      if (!riders.length) {

        selects.forEach(select => {
          select.innerHTML = `
            <option value="">
              No assignable riders
            </option>
          `;
        });

        return;
      }


      const options = `
        <option value="">
          Select a rider
        </option>

        ${
          riders.map(rider => `
            <option value="${rider.id}">
              ${rider.name || "Unnamed Rider"}
              — ${rider.riderRef || "No ID"}
            </option>
          `).join("")
        }
      `;


      selects.forEach(select => {
        select.innerHTML = options;
      });


    } catch (error) {

      console.error(
        "AVAILABLE RIDERS ERROR:",
        error
      );

      selects.forEach(select => {
        select.innerHTML = `
          <option value="">
            Unable to load riders
          </option>
        `;
      });

    }

  }

  async function assignRiderToOrder() {

    const select =
      document.getElementById("assignRiderSelect");

    const button =
      document.getElementById("assignRiderBtn");

    if (!select || !button) {
      return;
    }

    const orderId =
      Number(button.dataset.orderId);

    const riderId =
      Number(select.value);

    if (!orderId || !riderId) {
      toast("Please select a rider.");
      return;
    }

    button.disabled = true;
    button.textContent = "Assigning...";

    try {

      const response = await fetch(
        "/api/admin/orders/assign-rider",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          credentials: "same-origin",

          body: JSON.stringify({
            orderId: orderId,
            riderId: riderId
          })
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
          "Unable to assign rider."
        );
      }

      toast(
        "Rider assigned successfully."
      );

      /*
      * Close the current order modal
      */
      orderDetailsModal.classList.remove("show");

      orderDetailsModal.setAttribute(
        "aria-hidden",
        "true"
      );


      /*
      * Refresh the orders and riders
      */
      loadAdminOrders();
      loadAdminRecentOrders();
      loadAdminRiders();
      // loadAdminSummary();


    } catch (error) {

      console.error(
        "ASSIGN RIDER ERROR:",
        error
      );

      toast(
        error.message ||
        "Unable to assign rider."
      );

      button.disabled = false;
      button.textContent = "Assign Rider";

    }

  }

  document.addEventListener("click", async event => {

    const button =
      event.target.closest("#startDeliveryBtn");

    if (!button) return;

    const orderId =
      button.dataset.orderId;

    if (!orderId) return;

    try {

      button.disabled = true;
      button.textContent = "Starting...";

      const response = await fetch(
        "/api/admin/orders/update-status",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          credentials: "same-origin",

          body: JSON.stringify({
            orderId: orderId,
            status: "on_delivery"
          })
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
          "Unable to start delivery."
        );
      }

      toast(
        "Delivery started successfully."
      );

      orderDetailsModal.classList.remove("show");

      await loadAdminOrders();
      await loadAdminRecentOrders();
      await loadAdminRiders();
      // await loadAdminSummary();

    } catch (error) {

      console.error(
        "START DELIVERY ERROR:",
        error
      );

      toast(error.message);

      button.disabled = false;
      button.textContent = "Start Delivery";
    }

  });

  document.addEventListener("click", async event => {

    const button =
      event.target.closest("#markDeliveredBtn");

    if (!button) return;

    const orderId =
      button.dataset.orderId;

    if (!orderId) return;

    try {

      button.disabled = true;
      button.textContent = "Completing...";

      const response = await fetch(
        "/api/admin/orders/update-status",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          credentials: "same-origin",

          body: JSON.stringify({
            orderId: orderId,
            status: "delivered"
          })
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
          "Unable to complete delivery."
        );
      }

      toast(
        "Delivery completed successfully."
      );

      orderDetailsModal.classList.remove("show");

      await loadAdminOrders();
      await loadAdminRecentOrders();
      await loadAdminRiders();
      // await loadAdminSummary();

    } catch (error) {

      console.error(
        "MARK DELIVERED ERROR:",
        error
      );

      toast(error.message);

      button.disabled = false;
      button.textContent = "Mark Delivered";
    }

  });

  document.addEventListener("click", async event => {

    const button =
      event.target.closest("#markFailedBtn");

    if (!button) return;

    const orderId =
      button.dataset.orderId;

    if (!orderId) return;

    try {

      button.disabled = true;
      button.textContent = "Failing...";

      const response = await fetch(
        "/api/admin/orders/update-status",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          credentials: "same-origin",

          body: JSON.stringify({
            orderId: orderId,
            status: "failed"
          })
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
          "Unable to mark delivery as failed."
        );
      }

      toast(
        "Delivery marked as failed."
      );

      orderDetailsModal.classList.remove("show");

      await loadAdminOrders();

      await loadAdminRiders();

    } catch (error) {

      console.error(
        "MARK FAILED ERROR:",
        error
      );

      toast(error.message);

      button.disabled = false;
      button.textContent = "Mark Failed";

    }

  });

  document.addEventListener("click", async event => {

    const button =
      event.target.closest("#reassignRiderBtn");

    if (!button) return;

    const orderId =
      button.dataset.orderId;

    const select =
      document.getElementById("reassignRiderSelect");

    if (!orderId || !select) {
      return;
    }

    const riderId =
      select.value;

    if (!riderId) {

      toast(
        "Please select a rider first."
      );

      return;
    }

    try {

      button.disabled = true;
      button.textContent = "Reassigning...";

      const response = await fetch(
        "/api/admin/orders/reassign-rider",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          credentials: "same-origin",

          body: JSON.stringify({
            orderId: orderId,
            riderId: riderId
          })
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
          "Unable to reassign rider."
        );
      }

      toast(
        "Rider reassigned successfully."
      );

      orderDetailsModal.classList.remove(
        "show"
      );

      await loadAdminOrders();

      await loadAdminRiders();

    } catch (error) {

      console.error(
        "REASSIGN RIDER ERROR:",
        error
      );

      toast(
        error.message ||
        "Unable to reassign rider."
      );

      button.disabled = false;
      button.textContent = "Reassign Rider";

    }

  });

  document.addEventListener(
    "click",
    event => {

      if (
        event.target &&
        event.target.id === "assignRiderBtn"
      ) {

        assignRiderToOrder();

      }

    }
  );

  /* =====================================================
    ADMIN TOAST
  ===================================================== */

  function showAdminToast(message, type = "success") {

    const toast =
      document.getElementById("adminToast");

    if (!toast) {
      return;
    }

    toast.textContent = message;

    toast.className =
      "admin-toast show " + type;

    clearTimeout(
      showAdminToast.timer
    );

    showAdminToast.timer =
      setTimeout(() => {

        toast.classList.remove("show");

      }, 3000);

  }

  /* =======================================================
    LOAD ADMIN ORDERS
  ======================================================= */

  let ordersCurrentPage = 1;
  let ordersPagination = { page: 1, pageSize: 50, total: 0, totalPages: 1 };

  async function loadAdminOrders() {

    const tableBody =
      document.getElementById("adminOrdersBody");

    if (!tableBody) return;

    try {

      const search = document.getElementById("ordersSearchInput")?.value.trim() || "";
      const status = document.getElementById("ordersStatusFilter")?.value || "";
      const pageSize = document.getElementById("ordersPageSize")?.value || "50";

      const params = new URLSearchParams({
        page: String(ordersCurrentPage),
        pageSize,
      });
      if (search) params.set("search", search);
      if (status) params.set("status", status);

      const response = await fetch(
        `/api/admin/orders?${params.toString()}`,
        {
          credentials: "same-origin"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Unable to load orders."
        );
      }

      adminOrders = data.orders || [];
      ordersPagination = data.pagination || { page: 1, pageSize: 50, total: adminOrders.length, totalPages: 1 };

      const paginationInfo = document.getElementById("ordersPaginationInfo");
      const prevBtn = document.getElementById("ordersPrevPage");
      const nextBtn = document.getElementById("ordersNextPage");
      if (paginationInfo) {
        paginationInfo.textContent = `Page ${ordersPagination.page} of ${ordersPagination.totalPages} (${ordersPagination.total} orders)`;
      }
      if (prevBtn) prevBtn.disabled = ordersPagination.page <= 1;
      if (nextBtn) nextBtn.disabled = ordersPagination.page >= ordersPagination.totalPages;

      const orders = adminOrders;


      if (!orders.length) {

        tableBody.innerHTML = `
          <tr>
            <td colspan="9" class="empty-state">
              No orders found.
            </td>
          </tr>
        `;

        return;
      }


      tableBody.innerHTML = orders.map(order => {

        const createdDate = order.createdAt
          ? new Date(order.createdAt).toLocaleDateString(
              "en-GB",
              {
                day: "2-digit",
                month: "short",
                year: "numeric"
              }
            )
          : "—";


        const { label: statusLabel, className: statusClass } = getOrderStatusMeta(order.status);


        const account =
          order.vendorName || "—";


        return `
          <tr>

            <!-- Checkbox -->
            <td>
              <input type="checkbox" class="order-select-checkbox" data-order-id="${order.id}" aria-label="Select order ${order.orderRef}"${selectedOrderIds.has(String(order.id)) ? " checked" : ""}>
            </td>

            <!-- Order -->
            <td>
              <strong>${order.orderRef || "—"}</strong>
            </td>


            <!-- Vendor -->
            <td>
              ${account}
            </td>


            <!-- Pickup -->
            <td>
              ${order.pickup || "—"}
            </td>


            <!-- Destination -->
            <td>
              ${order.dropoff || "—"}
            </td>


            <!-- Units -->
            <td>
              ${order.units ?? 0}
            </td>


            <!-- Status -->
            <td>
              <span class="order-status ${statusClass}">
                ${statusLabel}
              </span>
            </td>


            <!-- Date -->
            <td>
              ${createdDate}
            </td>


            <!-- Action -->
            <td>
              <button
                type="button"
                class="btn outline order-view-btn"
                data-order-id="${order.id}"
              >
                View
              </button>
            </td>

          </tr>
        `;

      }).join("");

      const selectAllCheckbox = document.getElementById(
        "selectAllOrdersCheckbox"
      );

      if (selectAllCheckbox) {
        selectAllCheckbox.checked =
          orders.length > 0 && orders.every(order =>
            selectedOrderIds.has(String(order.id))
          );
      }

      updateBulkAssignmentPanel();

      /* Setup bulk assignment event listeners */
      setupBulkAssignmentListeners();

    } catch (error) {

      console.error(
        "ADMIN ORDERS ERROR:",
        error
      );

      tableBody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-state">
            Unable to load orders.
          </td>
        </tr>
      `;

    }

  }

  /* ---------------------------------------------------
     ORDERS SEARCH / FILTER / PAGINATION WIRING
  --------------------------------------------------- */

  let ordersSearchDebounce = null;
  document.getElementById("ordersSearchInput")?.addEventListener("input", () => {
    clearTimeout(ordersSearchDebounce);
    ordersSearchDebounce = setTimeout(() => {
      ordersCurrentPage = 1;
      loadAdminOrders();
    }, 350);
  });
  document.getElementById("ordersStatusFilter")?.addEventListener("change", () => {
    ordersCurrentPage = 1;
    loadAdminOrders();
  });
  document.getElementById("ordersPageSize")?.addEventListener("change", () => {
    ordersCurrentPage = 1;
    loadAdminOrders();
  });
  document.getElementById("ordersPrevPage")?.addEventListener("click", () => {
    if (ordersCurrentPage > 1) {
      ordersCurrentPage -= 1;
      loadAdminOrders();
    }
  });
  document.getElementById("ordersNextPage")?.addEventListener("click", () => {
    if (ordersCurrentPage < ordersPagination.totalPages) {
      ordersCurrentPage += 1;
      loadAdminOrders();
    }
  });

  /* ========================================================
     BULK ASSIGNMENT FUNCTIONS
  ======================================================== */

  function setupBulkAssignmentListeners() {
    const selectAllCheckbox = document.getElementById("selectAllOrdersCheckbox");
    const orderCheckboxes = document.querySelectorAll(".order-select-checkbox");
    const bulkPanel = document.getElementById("bulkAssignmentPanel");
    const bulkRiderSelect = document.getElementById("bulkAssignRiderSelect");
    const bulkAssignBtn = document.getElementById("bulkAssignBtn");
    const bulkCancelBtn = document.getElementById("bulkCancelBtn");

    // Select/Deselect all checkboxes
    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener("change", (e) => {
        orderCheckboxes.forEach(cb => {
          cb.checked = e.target.checked;

          if (e.target.checked) {
            selectedOrderIds.add(cb.dataset.orderId);
          } else {
            selectedOrderIds.delete(cb.dataset.orderId);
          }
        });
        updateBulkAssignmentPanel();
        populateBulkRiderSelect();
      });
    }

    // Individual checkbox changes
    orderCheckboxes.forEach(checkbox => {
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selectedOrderIds.add(checkbox.dataset.orderId);
        } else {
          selectedOrderIds.delete(checkbox.dataset.orderId);
        }

        if (selectAllCheckbox) {
          selectAllCheckbox.checked = Array.from(orderCheckboxes).every(
            item => item.checked
          );
        }

        updateBulkAssignmentPanel();
        populateBulkRiderSelect();
      });
    });

    // Bulk assign button
    if (bulkAssignBtn) {
      bulkAssignBtn.addEventListener("click", bulkAssignOrders);
    }

    // Cancel bulk assignment
    if (bulkCancelBtn) {
      bulkCancelBtn.addEventListener("click", () => {
        orderCheckboxes.forEach(cb => cb.checked = false);
        selectedOrderIds.clear();
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
        updateBulkAssignmentPanel();
      });
    }
  }

  function updateBulkAssignmentPanel() {
    const count = selectedOrderIds.size;
    const panel = document.getElementById("bulkAssignmentPanel");
    const countSpan = document.getElementById("selectedOrdersCount");

    if (count > 0) {
      panel.classList.remove("hidden");
      countSpan.textContent = `${count} order${count !== 1 ? "s" : ""} selected`;
    } else {
      panel.classList.add("hidden");
    }
  }

  async function populateBulkRiderSelect() {
    const select = document.getElementById("bulkAssignRiderSelect");
    if (!select) return;

    // Only populate if empty
    if (select.options.length > 1) return;

    try {
      const response = await fetch("/api/admin/riders", { credentials: "same-origin" });
      const data = await response.json();
      if (response.ok && data.riders) {
        data.riders
          .filter(rider => rider.isLoggedIn && rider.status !== "on_delivery")
          .forEach(rider => {
          const option = document.createElement("option");
          option.value = rider.id;
          option.textContent = `${rider.name} (${rider.riderRef})`;
          select.appendChild(option);
        });
      }
    } catch (error) {
      console.error("Error loading riders:", error);
    }
  }

  async function bulkAssignOrders() {
    const riderId = document.getElementById("bulkAssignRiderSelect").value;

    if (!riderId) {
      toast("Please select a rider.");
      return;
    }

    if (selectedOrderIds.size === 0) {
      toast("Please select at least one order.");
      return;
    }

    const orderIds = Array.from(selectedOrderIds).map(Number);

    const bulkAssignBtn = document.getElementById("bulkAssignBtn");
    bulkAssignBtn.disabled = true;
    bulkAssignBtn.textContent = "Assigning...";

    try {
      const response = await fetch(
        "/api/admin/orders/bulk-assign",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            orderIds,
            riderId: Number(riderId)
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to assign orders.");
      }

      toast(`${orderIds.length} order${orderIds.length !== 1 ? "s" : ""} assigned successfully.`);

      // Refresh orders and riders
      loadAdminOrders();
      loadAdminRiders();

      // Clear selections
      selectedOrderIds.clear();
      document.querySelectorAll(".order-select-checkbox").forEach(cb => cb.checked = false);
      document.getElementById("selectAllOrdersCheckbox").checked = false;
      updateBulkAssignmentPanel();

    } catch (error) {
      console.error("BULK ASSIGN ERROR:", error);
      toast(error.message || "Unable to assign orders.");
      bulkAssignBtn.disabled = false;
      bulkAssignBtn.textContent = "Assign to Rider";
    }
  }

  async function loadAdminRecentOrders() {

    const tableBody =
      document.getElementById("adminRecentOrdersBody");

    if (!tableBody) return;

    try {

      const response = await fetch(
        "/api/admin/orders",
        {
          credentials: "same-origin"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Unable to load recent orders."
        );
      }

      const orders =
        data.orders || [];


      /* =====================================================
        EMPTY STATE
      ===================================================== */

      if (!orders.length) {

        tableBody.innerHTML = `
          <tr>
            <td
              colspan="7"
              class="empty-state"
            >
              No orders yet.
            </td>
          </tr>
        `;

        return;
      }


      /* =====================================================
        GET MOST RECENT ORDERS
      ===================================================== */

      const recentOrders =
        [...orders]
          .sort(
            (a, b) =>
              new Date(b.createdAt || 0) -
              new Date(a.createdAt || 0)
          )
          .slice(0, 5);


      /* =====================================================
        RENDER
      ===================================================== */

      tableBody.innerHTML =
        recentOrders.map(order => {

          const createdDate =
            order.createdAt
              ? new Date(
                  order.createdAt
                ).toLocaleDateString(
                  "en-GB",
                  {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                  }
                )
              : "—";


          const { label: statusLabel, className: statusClass } = getOrderStatusMeta(order.status);



          return `
            <tr>

              <!-- Vendor -->
              <td>
                <strong>
                  ${order.vendorName || "—"}
                </strong>
              </td>


              <!-- Pickup -->
              <td>
                ${order.pickup || "—"}
              </td>


              <!-- Destination -->
              <td>
                ${order.dropoff || "—"}
              </td>


              <!-- Units -->
              <td>
                ${order.units ?? 0}
              </td>


              <!-- Status -->
              <td>
                <span class="order-status ${statusClass}">
                  ${statusLabel}
                </span>
              </td>


              <!-- Date -->
              <td>
                ${createdDate}
              </td>

              <!-- Action -->
              <td>
                <button
                  type="button"
                  class="btn outline order-view-btn"
                  data-order-id="${order.id}"
                >
                  View
                </button>
              </td>

            </tr>
          `;

        }).join("");


    } catch (error) {

      console.error(
        "ADMIN RECENT ORDERS ERROR:",
        error
      );

      tableBody.innerHTML = `
        <tr>
          <td
            colspan="7"
            class="empty-state"
          >
            Unable to load recent orders.
          </td>
        </tr>
      `;

    }

  }

  document.addEventListener("click", event => {

    const button = event.target.closest(".order-view-btn");

    if (!button) return;

    const orderId = button.dataset.orderId;

    if (!orderId) return;

    const order = adminOrders.find(
      item => String(item.id) === String(orderId)
    );

    if (!order) {
      console.error("Order not found:", orderId);
      return;
    }

    openOrderDetails(order);

  });

  /* =======================================================
    ORDER DETAILS
  ======================================================= */

  const orderDetailsModal =
    document.getElementById("orderDetailsModal");

  const orderDetailsBody =
    document.getElementById("orderDetailsBody");

  const orderDetailsTitle =
    document.getElementById("orderDetailsTitle");

  const closeOrderDetails =
    document.getElementById("closeOrderDetails");

  const orderDetailsBackdrop =
    document.getElementById("orderDetailsBackdrop");

  const subscriptionDetailsModal =
  document.getElementById(
    "subscriptionDetailsModal"
  );

  const subscriptionDetailsBody =
    document.getElementById(
      "subscriptionDetailsBody"
    );

  const subscriptionDetailsTitle =
    document.getElementById(
      "subscriptionDetailsTitle"
    );

  const closeSubscriptionDetails =
    document.getElementById(
      "closeSubscriptionDetails"
    );

  const subscriptionDetailsBackdrop =
    document.getElementById(
      "subscriptionDetailsBackdrop"
    );

  const addRiderModal =
    document.getElementById("addRiderModal");

  const addRiderBackdrop =
    document.getElementById("addRiderBackdrop");

  const addRiderBtn =
    document.getElementById("addRiderBtn");

  const closeAddRider =
    document.getElementById("closeAddRider");

  const cancelAddRider =
    document.getElementById("cancelAddRider");

  const addRiderForm =
    document.getElementById("addRiderForm");

  const riderDetailsModal =
    document.getElementById("riderDetailsModal");

  const riderDetailsBody =
    document.getElementById("riderDetailsBody");

  const riderDetailsTitle =
    document.getElementById("riderDetailsTitle");

  const closeRiderDetails =
    document.getElementById("closeRiderDetails");

  const riderDetailsBackdrop =
    document.getElementById("riderDetailsBackdrop");

  /* =====================================================
    EDIT RIDER ELEMENTS
  ===================================================== */

  const editRiderModal =
    document.getElementById("editRiderModal");

  const editRiderId =
    document.getElementById("editRiderId");

  const editRiderName =
    document.getElementById("editRiderName");

  const editRiderPhone =
    document.getElementById("editRiderPhone");

  const editRiderEmail =
    document.getElementById("editRiderEmail");

  const editRiderVehicle =
    document.getElementById("editRiderVehicle");

  const editRiderStatus =
    document.getElementById("editRiderStatus");

  const closeEditRider =
    document.getElementById("closeEditRider");

  const cancelEditRider =
    document.getElementById("cancelEditRider");

  const editRiderBackdrop =
    document.getElementById("editRiderBackdrop");

  const editRiderForm =
    document.getElementById("editRiderForm");

  /* =====================================================
    CLOSE EDIT RIDER MODAL
  ===================================================== */

  function closeEditRiderModal() {

    if (!editRiderModal) {
      return;
    }

    editRiderModal.classList.remove("show");

    editRiderModal.setAttribute(
      "aria-hidden",
      "true"
    );

  }

  /* =====================================================
    SAVE EDITED RIDER
  ===================================================== */

  if (editRiderForm) {

    editRiderForm.addEventListener(
      "submit",
      async (event) => {

        event.preventDefault();


        const riderId =
          Number(editRiderId.value);


        const payload = {

          id: riderId,

          name:
            editRiderName.value.trim(),

          phone:
            editRiderPhone.value.trim(),

          email:
            editRiderEmail.value.trim(),

          vehicle:
            editRiderVehicle.value.trim(),

          status:
            editRiderStatus.value

        };


        if (
          !payload.id ||
          !payload.name ||
          !payload.phone ||
          !payload.vehicle
        ) {

          showAdminToast(
            "Rider name, phone, and vehicle are required.",
            "error"
          );

          return;

        }


        const saveButton =
          document.getElementById(
            "saveEditRider"
          );


        const originalText =
          saveButton
            ? saveButton.textContent
            : "Save Changes";


        try {

          if (saveButton) {

            saveButton.disabled = true;

            saveButton.textContent =
              "Saving...";

          }


          const response =
            await fetch(
              "/api/admin/riders/update",
              {
                method: "POST",

                credentials: "same-origin",

                headers: {
                  "Content-Type":
                    "application/json"
                },

                body:
                  JSON.stringify(payload)
              }
            );


          const data =
            await response.json();


          if (!response.ok) {

            throw new Error(
              data.error ||
              "Unable to update rider."
            );

          }


          showAdminToast(
            data.message ||
            "Rider updated successfully.",
            "success"
          );


          closeEditRiderModal();


          await loadAdminRiders();


        } catch (error) {

          console.error(
            "EDIT RIDER ERROR:",
            error
          );


          showAdminToast(
            error.message ||
            "Unable to update rider.",
            "error"
          );


        } finally {

          if (saveButton) {

            saveButton.disabled = false;

            saveButton.textContent =
              originalText;

          }

        }

      }
    );

  }


  if (closeEditRider) {

    closeEditRider.addEventListener(
      "click",
      closeEditRiderModal
    );

  }


  if (cancelEditRider) {

    cancelEditRider.addEventListener(
      "click",
      closeEditRiderModal
    );

  }


  if (editRiderBackdrop) {

    editRiderBackdrop.addEventListener(
      "click",
      closeEditRiderModal
    );

  }

  function openAddRiderModal() {

    if (!addRiderModal) {
      return;
    }

    addRiderModal.classList.add("show");

    addRiderModal.setAttribute(
      "aria-hidden",
      "false"
    );

  }

  function closeAddRiderModal() {

    if (!addRiderModal) {
      return;
    }

    addRiderModal.classList.remove("show");

    addRiderModal.setAttribute(
      "aria-hidden",
      "true"
    );

  }

  function openRiderDetails(rider) {

    if (!riderDetailsModal || !riderDetailsBody) {
      return;
    }


    riderDetailsTitle.textContent =
      rider.name || "Rider Details";

    const currentOrder =
      adminOrders.find(
        order =>
          String(order.riderId) === String(rider.id) &&
          (
            order.status === "assigned" ||
            order.status === "on_delivery"
          )
      );

    const riderDeliveries =
      rider.deliveries ||
      adminOrders.filter(
        order => String(order.riderId) === String(rider.id)
      );


    riderDetailsBody.innerHTML = `

      <div class="vendor-detail-grid">

        <div class="vendor-detail-item">
          <span class="stat-label">Rider ID</span>
          <strong>
            ${rider.riderRef || "—"}
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span class="stat-label">Phone</span>
          <strong>
            ${rider.phone || "—"}
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span class="stat-label">Email</span>
          <strong>
            ${rider.email || "—"}
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span class="stat-label">Vehicle</span>
          <strong>
            ${rider.vehicle || "—"}
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span class="stat-label">Status</span>
          <strong>
            ${rider.status || "—"}
          </strong>
        </div>

        <div class="vendor-detail-item">
          <span class="stat-label">Current Assigned Order</span>
          <strong>
            ${
              currentOrder
                ? currentOrder.orderRef || "—"
                : "None"
            }
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span class="stat-label">Total Deliveries</span>
          <strong>
            ${rider.totalDeliveries ?? 0}
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span class="stat-label">Completed Deliveries</span>
          <strong>
            ${rider.completedDeliveries ?? 0}
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span class="stat-label">Failed Deliveries</span>
          <strong>
            ${rider.failedDeliveries ?? 0}
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span class="stat-label">Date Added</span>
          <strong>
            ${
              rider.createdAt
                ? new Date(
                    rider.createdAt
                  ).toLocaleDateString(
                    "en-GB",
                    {
                      day: "2-digit",
                      month: "short",
                      year: "numeric"
                    }
                  )
                : "—"
            }
          </strong>
        </div>

      </div>

      <div class="rider-delivery-history">
        <h3>Delivery history</h3>
        ${riderDeliveries.length ? `
          <div class="table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Vendor</th>
                  <th>Route</th>
                  <th>Units</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                ${riderDeliveries.map(order => `
                  <tr>
                    <td>${order.orderRef || `#${order.id}`}</td>
                    <td>${order.vendorName || "—"}</td>
                    <td>${order.pickup || "—"} → ${order.dropoff || "—"}</td>
                    <td>${order.units ?? 0}</td>
                    <td>${order.status || "—"}</td>
                    <td>${order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-GB") : "—"}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : '<p class="muted">No deliveries have been assigned to this rider.</p>'}
      </div>

    `;


    riderDetailsModal.classList.add("show");

    riderDetailsModal.setAttribute(
      "aria-hidden",
      "false"
    );

  }

  /* =====================================================
    OPEN EDIT RIDER
  ===================================================== */

  function openEditRider(rider) {

    if (!editRiderModal) {
      return;
    }


    editRiderId.value =
      rider.id ?? "";


    editRiderName.value =
      rider.name || "";


    editRiderPhone.value =
      rider.phone || "";


    editRiderEmail.value =
      rider.email || "";


    editRiderVehicle.value =
      rider.vehicle || "";


    editRiderStatus.value =
      rider.status || "available";


    editRiderModal.classList.add("show");

    editRiderModal.setAttribute(
      "aria-hidden",
      "false"
    );

  }

  function closeRiderDetailsModal() {

    if (!riderDetailsModal) {
      return;
    }

    riderDetailsModal.classList.remove("show");

    riderDetailsModal.setAttribute(
      "aria-hidden",
      "true"
    );

  }

  closeRiderDetails?.addEventListener(
    "click",
    closeRiderDetailsModal
  );


  riderDetailsBackdrop?.addEventListener(
    "click",
    closeRiderDetailsModal
  );

  addRiderBtn?.addEventListener(
    "click",
    openAddRiderModal
  );


  closeAddRider?.addEventListener(
    "click",
    closeAddRiderModal
  );


  cancelAddRider?.addEventListener(
    "click",
    closeAddRiderModal
  );


  addRiderBackdrop?.addEventListener(
    "click",
    closeAddRiderModal
  );

  addRiderForm?.addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();


      const name =
        document.getElementById("riderName")?.value.trim();

      const phone =
        document.getElementById("riderPhone")?.value.trim();

      const email =
        document.getElementById("riderEmail")?.value.trim();

      const password =
        document.getElementById("riderPassword")?.value;

      const vehicle =
        document.getElementById("riderVehicle")?.value;


      if (!name || !phone || !vehicle || !password) {

        toast(
          "Rider name, phone, vehicle, and password are required."
        );

        return;
      }

      if (password.length < 8) {

        toast(
          "Rider password must be at least 8 characters."
        );

        return;
      }


      const saveButton =
        document.getElementById("saveRiderBtn");


      if (saveButton) {

        saveButton.disabled = true;

        saveButton.textContent = "Adding...";

      }


      try {

        const response = await fetch(
          "/api/admin/riders",
          {
            method: "POST",

            credentials: "same-origin",

            headers: {
              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({
              name,
              phone,
              email,
              password,
              vehicle
            })
          }
        );


        const data =
          await response.json();


        if (!response.ok) {

          throw new Error(
            data.error ||
            "Unable to create rider."
          );

        }


        // Close the modal
        closeAddRiderModal();


        // Reset the form
        addRiderForm.reset();


        // Reload the rider table
        await loadAdminRiders();


        showAdminToast(
          "Rider created successfully.",
          "success"
        );


      } catch (error) {

        console.error(
          "ADMIN CREATE RIDER ERROR:",
          error
        );


        toast(
          error.message ||
          "Unable to create rider."
        );


      } finally {

        if (saveButton) {

          saveButton.disabled = false;

          saveButton.textContent =
            "Add Rider";

        }

      }

    }
  );

  function openOrderDetails(order) {
    
    console.log("ORDER STATUS:", order.status);

    if (!orderDetailsModal || !orderDetailsBody) {
      return;
    }


    orderDetailsTitle.textContent =
      order.orderRef || "Order";


    const statusLabel = getOrderStatusMeta(order.status).label;


    const createdDate = order.createdAt
      ? new Date(order.createdAt).toLocaleDateString(
          "en-GB",
          {
            day: "2-digit",
            month: "short",
            year: "numeric"
          }
        )
      : "—";


    const details = order.details || {};


    orderDetailsBody.innerHTML = `

      <div class="vendor-detail-grid">

        <div class="vendor-detail-item">
          <span>Order Number</span>
          <strong>${order.orderRef || "—"}</strong>
        </div>

        <div class="vendor-detail-item">
          <span>Vendor</span>
          <strong>${order.vendorName || "—"}</strong>
        </div>

        <div class="vendor-detail-item">
          <span>Vendor Email</span>
          <strong>${order.accountEmail || "—"}</strong>
        </div>

        <div class="vendor-detail-item">
          <span>Status</span>
          <strong>${statusLabel}</strong>
        </div>

        <div class="vendor-detail-item">
          <span>Units</span>
          <strong>${order.units ?? 0}</strong>
        </div>

        <div class="vendor-detail-item">
          <span>Priority</span>
          <strong>${order.priority || "—"}</strong>
        </div>

        <div class="vendor-detail-item">
          <span>Package Type</span>
          <strong>${details.packageType || order.packageType || "—"}</strong>
        </div>

        <div class="vendor-detail-item">
          <span>Created</span>
          <strong>${createdDate}</strong>
        </div>

      </div>


      <div class="vendor-detail-section">

        <h3>Pickup Details</h3>

        <div class="vendor-detail-grid">

          <div class="vendor-detail-item">
            <span>Pickup Location</span>
            <strong>${order.pickup || "—"}</strong>
          </div>

          <div class="vendor-detail-item">
            <span>Pickup Contact</span>
            <strong>${details.pickupContactName || "—"}</strong>
          </div>

          <div class="vendor-detail-item">
            <span>Pickup Phone</span>
            <strong>${details.pickupPhone || "—"}</strong>
          </div>

          <div class="vendor-detail-item">
            <span>Pickup Address</span>
            <strong>${details.pickupAddress || "—"}</strong>
          </div>

        </div>

      </div>


      <div class="vendor-detail-section">

        <h3>Delivery Details</h3>

        <div class="vendor-detail-grid">

          <div class="vendor-detail-item">
            <span>Destination</span>
            <strong>${order.dropoff || "—"}</strong>
          </div>

          <div class="vendor-detail-item">
            <span>Recipient</span>
            <strong>${details.recipientName || "—"}</strong>
          </div>

          <div class="vendor-detail-item">
            <span>Recipient Phone</span>
            <strong>${details.recipientPhone || "—"}</strong>
          </div>

          <div class="vendor-detail-item">
            <span>Delivery Address</span>
            <strong>${details.deliveryAddress || "—"}</strong>
          </div>

          <div class="vendor-detail-item">
            <span>Delivery Window</span>
            <strong>${details.deliveryWindow || "—"}</strong>
          </div>

        </div>

      </div>

            <div class="vendor-detail-section">

        <h3>Rider Assignment</h3>

        <div class="vendor-detail-grid">

          <div class="vendor-detail-item">

            <span>Assigned Rider</span>

            <strong>
              ${
                order.riderName
                  ? order.riderName
                  : "Not assigned"
              }
            </strong>

          </div>


          <div class="vendor-detail-item">

            <span>Rider ID</span>

            <strong>
              ${
                order.riderRef
                  ? order.riderRef
                  : "—"
              }
            </strong>

          </div>


          <div class="vendor-detail-item">

            <span>Rider Phone</span>

            <strong>
              ${
                order.riderPhone
                  ? order.riderPhone
                  : "—"
              }
            </strong>

          </div>

        </div>


        ${
          !order.riderId &&
          order.status === "requested"
            ? `
              <div
                style="
                  margin-block-start: 16px;
                  display: flex;
                  gap: 12px;
                  align-items: center;
                  flex-wrap: wrap;
                "
              >

                <select
                  id="assignRiderSelect"
                  class="form-control"
                  style="min-inline-size: 220px;"
                >

                  <option value="">
                    Loading available riders...
                  </option>

                </select>

                <button
                  type="button"
                  class="btn primary"
                  id="assignRiderBtn"
                  data-order-id="${order.id}"
                >
                  Assign Rider
                </button>

              </div>
            `
            : order.status === "assigned"
              ? `
                <p class="muted" style="margin-block-start:16px">Waiting for the rider to accept this assignment.</p>
                <div
                  style="
                    margin-block-start: 8px;
                    display: flex;
                    gap: 12px;
                    flex-wrap: wrap;
                    align-items: center;
                  "
                >

                  <select
                    id="reassignRiderSelect"
                    class="form-control"
                    style="min-inline-size: 220px;"
                  >
                    <option value="">
                      Select new rider
                    </option>
                  </select>

                  <button
                    type="button"
                    class="btn outline"
                    id="reassignRiderBtn"
                    data-order-id="${order.id}"
                  >
                    Reassign Rider
                  </button>

                </div>
              `
              : ""
        }

        ${
          !["delivered", "failed", "cancelled", "returned"].includes(order.status)
            ? `
              <div style="margin-block-start:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">
                <select id="orderExceptionSelect" class="form-control" style="min-inline-size:180px">
                  <option value="failed">Mark Failed</option>
                  <option value="cancelled">Mark Cancelled</option>
                  <option value="returned">Mark Returned</option>
                </select>
                <input type="text" id="orderExceptionNote" class="form-control" placeholder="Reason (optional)" style="min-inline-size:220px">
                <button type="button" class="btn outline" id="applyOrderExceptionBtn" data-order-id="${order.id}">Apply</button>
              </div>
            `
            : ""
        }

      </div>

      <div class="vendor-detail-section">
        <h3>Tracking</h3>
        <div class="tracking-code-row">
          <code id="orderTrackingCodeValue">${order.trackingCode || "—"}</code>
          ${order.trackingCode ? `<button type="button" class="btn outline" id="copyTrackingCodeBtn" data-code="${order.trackingCode}">Copy</button>` : ""}
        </div>
      </div>

      <div class="vendor-detail-section">
        <h3>Delivery Timeline</h3>
        ${renderOrderTimeline(order.timeline)}
      </div>

      <div class="vendor-detail-section">
        <h3>Proof of Delivery</h3>
        ${renderProofOfDelivery(order)}
      </div>


      <div class="vendor-detail-section">

        <h3>Package & Instructions</h3>

        <div class="vendor-detail-grid">

          <div class="vendor-detail-item">
            <span>Package Description</span>
            <strong>${details.packageDescription || "—"}</strong>
          </div>

          <div class="vendor-detail-item">
            <span>Pickup Instructions</span>
            <strong>${details.pickupInstructions || "—"}</strong>
          </div>

          <div class="vendor-detail-item">
            <span>Delivery Instructions</span>
            <strong>${details.deliveryInstructions || "—"}</strong>
          </div>

        </div>

      </div>

    `;

    document.getElementById("copyTrackingCodeBtn")?.addEventListener("click", event => {
      const code = event.currentTarget.dataset.code;
      navigator.clipboard?.writeText(code).then(() => showAdminToast("Tracking code copied."));
    });

    document.getElementById("applyOrderExceptionBtn")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      const newStatus = document.getElementById("orderExceptionSelect")?.value;
      const note = document.getElementById("orderExceptionNote")?.value || "";
      button.disabled = true;
      try {
        const response = await fetch("/api/admin/orders/update-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ orderId: button.dataset.orderId, status: newStatus, note })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to update order.");
        showAdminToast("Order updated.");
        orderDetailsModal.classList.remove("show");
        await loadAdminOrders();
        await loadAdminRiders();
      } catch (error) {
        showAdminToast(error.message, "error");
        button.disabled = false;
      }
    });


    orderDetailsModal.classList.add("show");

    orderDetailsModal.setAttribute(
      "aria-hidden",
      "false"
    );

    loadAvailableRiders();

  }

  function openSubscriptionDetails(vendor) {

    if (
      !subscriptionDetailsModal ||
      !subscriptionDetailsBody
    ) {
      return;
    }


    subscriptionDetailsTitle.textContent =
      vendor.subscriberId || "Subscription";


    const amount =
      PLAN_PRICES[vendor.plan] ?? 0;


    const paymentDate =
      vendor.paidAt
        ? new Date(
            vendor.paidAt
          ).toLocaleDateString(
            "en-GB",
            {
              day: "2-digit",
              month: "short",
              year: "numeric"
            }
          )
        : "—";


    const renewalDate =
      vendor.renewalDate
        ? new Date(
            vendor.renewalDate
          ).toLocaleDateString(
            "en-GB",
            {
              day: "2-digit",
              month: "short",
              year: "numeric"
            }
          )
        : "—";


    const statusLabel =
      vendor.subscriptionState === "expiring_soon"
        ? "Expiring Soon"
        : vendor.subscriptionState === "pending_payment"
          ? "Pending Payment"
          : vendor.subscriptionState === "grace_period"
            ? "Grace Period"
            : vendor.subscriptionState === "no_plan"
              ? "No Plan"
              : vendor.subscriptionState === "active"
                ? "Active"
                : vendor.subscriptionState === "expired"
                  ? "Expired"
                  : vendor.subscriptionState || "—";


    subscriptionDetailsBody.innerHTML = `

      <div class="vendor-detail-grid">

        <div class="vendor-detail-item">
          <span>Subscriber ID</span>
          <strong>
            ${vendor.subscriberId || "—"}
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span>Vendor</span>
          <strong>
            ${vendor.name || "—"}
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span>Vendor Email</span>
          <strong>
            ${vendor.email || "—"}
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span>Plan</span>
          <strong>
            ${vendor.plan || "—"}
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span>Amount</span>
          <strong>
            ₦${amount.toLocaleString("en-NG")}
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span>Payment Date</span>
          <strong>
            ${paymentDate}
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span>Renewal Date</span>
          <strong>
            ${renewalDate}
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span>Payment Status</span>
          <strong>
            ${statusLabel}
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span>Units Allocated</span>
          <strong>
            ${vendor.unitsAllocated ?? 0}
          </strong>
        </div>


        <div class="vendor-detail-item">
          <span>Units Used</span>
          <strong>
            ${vendor.unitsUsed ?? 0}
          </strong>
        </div>

      </div>

    `;


    subscriptionDetailsModal.classList.add(
      "show"
    );

    subscriptionDetailsModal.setAttribute(
      "aria-hidden",
      "false"
    );

  }


  function closeOrderDetailsModal() {

    if (!orderDetailsModal) {
      return;
    }

    orderDetailsModal.classList.remove("show");

    orderDetailsModal.setAttribute(
      "aria-hidden",
      "true"
    );

  }

  function closeSubscriptionDetailsModal() {

    if (!subscriptionDetailsModal) {
      return;
    }

    subscriptionDetailsModal.classList.remove(
      "show"
    );

    subscriptionDetailsModal.setAttribute(
      "aria-hidden",
      "true"
    );

  }


  closeOrderDetails?.addEventListener(
    "click",
    closeOrderDetailsModal
  );


  orderDetailsBackdrop?.addEventListener(
    "click",
    closeOrderDetailsModal
  );

  closeSubscriptionDetails?.addEventListener(
    "click",
    closeSubscriptionDetailsModal
  );

  subscriptionDetailsBackdrop?.addEventListener(
    "click",
    closeSubscriptionDetailsModal
  );

  /* =======================================================
   VENDOR DETAILS
  ======================================================= */

  const vendorDetailsModal =
    document.getElementById("vendorDetailsModal");

  const vendorDetailsBody =
    document.getElementById("vendorDetailsBody");

  const vendorDetailsTitle =
    document.getElementById("vendorDetailsTitle");

  const closeVendorDetails =
    document.getElementById("closeVendorDetails");

  const vendorDetailsBackdrop =
    document.getElementById("vendorDetailsBackdrop");


  function openVendorDetails(vendor) {

    if (!vendorDetailsModal || !vendorDetailsBody) {
      return;
    }

    vendorDetailsTitle.textContent =
      vendor.name || "Vendor";


    const statusLabel =
      vendor.subscriptionState === "expiring_soon"
        ? "Expiring Soon"
        : vendor.subscriptionState === "pending_payment"
          ? "Pending Payment"
          : vendor.subscriptionState === "grace_period"
            ? "Grace Period"
            : vendor.subscriptionState === "no_plan"
              ? "No Plan"
              : vendor.subscriptionState === "expired"
                ? "Expired"
                : "Active";


    const renewalDate = vendor.renewalDate
      ? new Date(vendor.renewalDate).toLocaleDateString(
          "en-GB",
          {
            day: "2-digit",
            month: "short",
            year: "numeric"
          }
        )
      : "—";


    const stats =
      vendor.deliveryStats?.counts || {};


    vendorDetailsBody.innerHTML = `

      <div class="vendor-detail-grid">

        <div class="vendor-detail-item">
          <span>Name</span>
          <strong>${vendor.name || "—"}</strong>
        </div>

        <div class="vendor-detail-item">
          <span>Email</span>
          <strong>${vendor.email || "—"}</strong>
        </div>

        <div class="vendor-detail-item">
          <span>Subscriber ID</span>
          <strong>${vendor.subscriberId || "—"}</strong>
        </div>

        <div class="vendor-detail-item">
          <span>Plan</span>
          <strong>${vendor.plan || "—"}</strong>
        </div>

        <div class="vendor-detail-item">
          <span>Payment Status</span>
          <strong>${vendor.paymentStatus || "—"}</strong>
        </div>

        <div class="vendor-detail-item">
          <span>Subscription</span>
          <strong>${statusLabel}</strong>
        </div>

        <div class="vendor-detail-item">
          <span>Payment Date</span>
          <strong>
            ${
              vendor.paidAt
                ? new Date(vendor.paidAt).toLocaleDateString(
                    "en-GB",
                    {
                      day: "2-digit",
                      month: "short",
                      year: "numeric"
                    }
                  )
                : "—"
            }
          </strong>
        </div>

        <div class="vendor-detail-item">
          <span>Renewal Date</span>
          <strong>${renewalDate}</strong>
        </div>

        <div class="vendor-detail-item">
          <span>Grace Period Ends</span>
          <strong>
            ${
              vendor.gracePeriodEnd
                ? new Date(vendor.gracePeriodEnd).toLocaleDateString(
                    "en-GB",
                    {
                      day: "2-digit",
                      month: "short",
                      year: "numeric"
                    }
                  )
                : "—"
            }
          </strong>
        </div>

        <div class="vendor-detail-item">
          <span>Units Allocated</span>
          <strong>${vendor.unitsAllocated ?? 0}</strong>
        </div>

        <div class="vendor-detail-item">
          <span>Units Used</span>
          <strong>${vendor.unitsUsed ?? 0}</strong>
        </div>

        <div class="vendor-detail-item">
          <span>Units Remaining</span>
          <strong>${vendor.unitsRemaining ?? 0}</strong>
        </div>

      </div>

      <div class="vendor-detail-section">
        <h3>Manual Unit Adjustment</h3>
        <p class="muted">Adjustments are never silent - every change requires a reason and is permanently recorded.</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-block-end:12px">
          <input type="number" id="unitAdjustmentAmount" placeholder="+/- units, e.g. -5 or 10" style="max-inline-size:180px">
          <input type="text" id="unitAdjustmentReason" placeholder="Reason (required)" style="flex:1;min-inline-size:220px">
          <button type="button" class="btn outline" id="previewUnitAdjustmentBtn" data-email="${vendor.email}">Preview</button>
        </div>
        <div id="unitAdjustmentPreview" class="hidden" style="padding:14px;border:1px solid var(--border);border-radius:10px;margin-block-end:12px">
          <div class="vendor-detail-grid">
            <div class="vendor-detail-item"><span>Current Balance</span><strong id="unitAdjustmentCurrent">—</strong></div>
            <div class="vendor-detail-item"><span>Adjustment</span><strong id="unitAdjustmentDelta">—</strong></div>
            <div class="vendor-detail-item"><span>Resulting Balance</span><strong id="unitAdjustmentResult">—</strong></div>
          </div>
          <button type="button" class="btn primary" id="confirmUnitAdjustmentBtn" data-email="${vendor.email}" style="margin-block-start:12px">Confirm Adjustment</button>
        </div>
        <div id="unitAdjustmentHistory"><p class="muted">Loading adjustment history...</p></div>
      </div>

      <div class="vendor-detail-section">

        <h3>Delivery Performance</h3>

        <div class="vendor-detail-stats">

          <div>
            <span>Total Orders</span>
            <strong>${vendor.deliveryStats?.total ?? 0}</strong>
          </div>

          <div>
            <span>requested</span>
            <strong>${stats.requested ?? 0}</strong>
          </div>

          <div>
            <span>assigned</span>
            <strong>${stats.assigned ?? 0}</strong>
          </div>

          <div>
            <span>picked Up</span>
            <strong>${stats["picked-up"] ?? 0}</strong>
          </div>

          <div>
            <span>in Transit</span>
            <strong>${stats["in-transit"] ?? 0}</strong>
          </div>

          <div>
            <span>delivered</span>
            <strong>${stats.delivered ?? 0}</strong>
          </div>

          <div>
            <span>failed</span>
            <strong>${stats.failed ?? 0}</strong>
          </div>

          <div>
            <span>cancelled</span>
            <strong>${stats.cancelled ?? 0}</strong>
          </div>

        </div>

      </div>

    `;

    document.getElementById("previewUnitAdjustmentBtn")?.addEventListener("click", () => {
      const amount = parseInt(document.getElementById("unitAdjustmentAmount").value, 10);
      if (!amount) {
        showAdminToast("Enter a non-zero whole number of units.", "error");
        return;
      }
      const current = vendor.unitsRemaining ?? 0;
      document.getElementById("unitAdjustmentCurrent").textContent = current;
      document.getElementById("unitAdjustmentDelta").textContent = amount > 0 ? `+${amount}` : amount;
      document.getElementById("unitAdjustmentResult").textContent = current + amount;
      document.getElementById("unitAdjustmentPreview").classList.remove("hidden");
    });

    document.getElementById("confirmUnitAdjustmentBtn")?.addEventListener("click", async event => {
      const amount = parseInt(document.getElementById("unitAdjustmentAmount").value, 10);
      const reason = document.getElementById("unitAdjustmentReason").value.trim();
      if (!reason) {
        showAdminToast("A reason is required for every unit adjustment.", "error");
        return;
      }
      if (!window.confirm(`Apply a ${amount > 0 ? "+" : ""}${amount} unit adjustment? This is permanent and will be logged.`)) {
        return;
      }
      try {
        await teamRequest("/api/admin/vendors/adjust-units", {
          email: event.currentTarget.dataset.email,
          units: amount,
          reason
        });
        showAdminToast("Units adjusted successfully.");
        closeVendorDetailsModal();
        loadAdminVendors();
      } catch (error) {
        showAdminToast(error.message, "error");
      }
    });

    loadUnitAdjustmentHistory(vendor.email);

    vendorDetailsModal.classList.add("show");
    vendorDetailsModal.setAttribute("aria-hidden", "false");
  }

  async function loadUnitAdjustmentHistory(email) {
    const container = document.getElementById("unitAdjustmentHistory");
    if (!container) return;
    try {
      const data = await api(`/api/admin/unit-adjustments?email=${encodeURIComponent(email)}`);
      const entries = data.adjustments || [];
      if (!entries.length) {
        container.innerHTML = '<p class="muted">No manual unit adjustments have been made for this vendor.</p>';
        return;
      }
      container.innerHTML = `
        <table class="admin-table">
          <thead><tr><th>Date</th><th>Adjustment</th><th>Reason</th><th>Admin</th><th>Prev → New</th></tr></thead>
          <tbody>
            ${entries.map(entry => `
              <tr>
                <td>${entry.at ? new Date(entry.at).toLocaleString("en-GB") : "—"}</td>
                <td>${entry.unitsDelta > 0 ? "+" : ""}${entry.unitsDelta}</td>
                <td>${entry.reason || "—"}</td>
                <td>${entry.adminEmail || "—"}</td>
                <td>${entry.previousBalance} → ${entry.newBalance}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    } catch (error) {
      container.innerHTML = `<p class="muted">${error.message}</p>`;
    }
  }

  function closeVendorDetailsModal() {
    if (!vendorDetailsModal) {
      return;
    }

    vendorDetailsModal.classList.remove("show");
    vendorDetailsModal.setAttribute("aria-hidden", "true");
  }


  closeVendorDetails?.addEventListener(
    "click",
    closeVendorDetailsModal
  );


  vendorDetailsBackdrop?.addEventListener(
    "click",
    closeVendorDetailsModal
  );

  const changePasswordBtn =
    document.getElementById("changePasswordBtn");

  const changePasswordForm =
    document.getElementById("changePasswordForm");

  const cancelPasswordBtn =
    document.getElementById("cancelPasswordBtn");

  if (changePasswordBtn) {

    changePasswordBtn.addEventListener("click", () => {

      changePasswordForm.classList.remove("hidden");

      changePasswordBtn.classList.add("hidden");

    });

  }


  if (cancelPasswordBtn) {

    cancelPasswordBtn.addEventListener("click", () => {

      changePasswordForm.classList.add("hidden");

      changePasswordBtn.classList.remove("hidden");

      document.getElementById("currentPassword").value = "";
      document.getElementById("newPassword").value = "";
      document.getElementById("confirmPassword").value = "";

    });

  }

  const savePasswordBtn =
    document.getElementById("savePasswordBtn");

  if (savePasswordBtn) {

  savePasswordBtn.addEventListener("click", async () => {

    console.log("ADMIN PASSWORD BUTTON CLICKED");


    const currentPasswordInput =
      document.getElementById("currentPassword");

    const newPasswordInput =
      document.getElementById("newPassword");

    const confirmPasswordInput =
      document.getElementById("confirmPassword");


    console.log(
      "PASSWORD INPUTS:",
      {
        current: currentPasswordInput,
        newPassword: newPasswordInput,
        confirm: confirmPasswordInput
      }
    );


    if (
      !currentPasswordInput ||
      !newPasswordInput ||
      !confirmPasswordInput
    ) {

      console.error(
        "One or more password inputs are missing."
      );

      toast(
        "Password form fields could not be found."
      );

      return;

    }


    const currentPassword =
      currentPasswordInput.value;

    const newPassword =
      newPasswordInput.value;

    const confirmPassword =
      confirmPasswordInput.value;


      if (
        !currentPassword ||
        !newPassword ||
        !confirmPassword
      ) {

        toast(
          "Please complete all password fields."
        );

        return;

      }


      if (newPassword.length < 8) {

        toast(
          "New password must be at least 8 characters."
        );

        return;

      }


      if (newPassword !== confirmPassword) {

        toast(
          "New passwords do not match."
        );

        return;

      }


      savePasswordBtn.disabled = true;

      savePasswordBtn.textContent =
        "Updating…";


      try {

        const response = await fetch(
          "/api/admin/change-password",
          {
            method: "POST",

            headers: {
              "Content-Type": "application/json"
            },

            credentials: "same-origin",

            body: JSON.stringify({
              currentPassword: currentPassword,
              newPassword: newPassword
            })
          }
        );


        const data =
          await response.json();


        if (!response.ok) {

          throw new Error(
            data.error ||
            "Unable to change password."
          );

        }


        toast(
          "Admin password changed successfully."
        );

        if (passwordChangeRequired()) {
          // Reload so the hard gate lifts and normal navigation/data loads resume.
          window.location.reload();
          return;
        }

        document.getElementById(
          "currentPassword"
        ).value = "";

        document.getElementById(
          "newPassword"
        ).value = "";

        document.getElementById(
          "confirmPassword"
        ).value = "";


        changePasswordForm.classList.add(
          "hidden"
        );

        changePasswordBtn.classList.remove(
          "hidden"
        );


      } catch (error) {

        console.error(
          "ADMIN CHANGE PASSWORD ERROR:",
          error
        );

        toast(
          error.message ||
          "Unable to change password."
        );

      } finally {

        savePasswordBtn.disabled = false;

        savePasswordBtn.textContent =
          "Update Password";

      }

    });

  }

  /* =======================================================
    ADMIN NOTIFICATION SETTINGS
  ======================================================= */

  function saveAdminNotificationSettings() {

    const settings = {

      deliveryUpdates:
        document.getElementById(
          "settingDeliveryUpdates"
        ).checked,

      lowUnitAlerts:
        document.getElementById(
          "settingLowUnitAlerts"
        ).checked,

      renewalReminders:
        document.getElementById(
          "settingRenewalReminders"
        ).checked

    };


    localStorage.setItem(
      "fiableAdminNotificationSettings",
      JSON.stringify(settings)
    );


    toast(
      "Notification preferences saved."
    );

  }


  function loadAdminNotificationSettings() {

    const settings = JSON.parse(
      localStorage.getItem(
        "fiableAdminNotificationSettings"
      ) || "{}"
    );


    const deliveryUpdates =
      document.getElementById(
        "settingDeliveryUpdates"
      );

    const lowUnitAlerts =
      document.getElementById(
        "settingLowUnitAlerts"
      );

    const renewalReminders =
      document.getElementById(
        "settingRenewalReminders"
      );


    if (deliveryUpdates) {

      deliveryUpdates.checked =
        settings.deliveryUpdates !== false;

    }


    if (lowUnitAlerts) {

      lowUnitAlerts.checked =
        settings.lowUnitAlerts !== false;

    }


    if (renewalReminders) {

      renewalReminders.checked =
        settings.renewalReminders !== false;

    }

  }

  const saveNotificationSettingsBtn =
    document.getElementById(
      "saveNotificationSettingsBtn"
    );


  if (saveNotificationSettingsBtn) {

    saveNotificationSettingsBtn.addEventListener(
      "click",
      () => {

        saveAdminNotificationSettings();

      }
    );

  }

  /* =======================================================
    AUTO REFRESH ADMIN DATA
    Role-aware: only refreshes sections the logged-in admin can
    actually view (per NAV_VIEW_PERMISSIONS), and only polls
    operational data (orders) on the fast interval. Team/vendor/
    finance/rider data refresh on a slower interval since they
    change far less often and were causing needless load + noisy
    403s for roles without access.
  ======================================================= */

  function adminCanView(permission) {
    if (!currentAdmin) return false;
    if (!permission) return true;
    const permissions = new Set(currentAdmin.permissions || []);
    return permissions.has("*") || permissions.has(permission);
  }

  const ADMIN_FAST_REFRESH_MS = 5000;
  const ADMIN_SLOW_REFRESH_MS = 30000;

  setInterval(
    () => {

      if (
        document.visibilityState === "visible" &&
        !passwordChangeRequired()
      ) {
        loadAdminDashboard();
        if (adminCanView("view_orders")) {
          loadAdminOrders();
          loadAdminRecentOrders();
        }
      }

    },
    ADMIN_FAST_REFRESH_MS
  );

  setInterval(
    () => {

      if (
        document.visibilityState === "visible" &&
        !passwordChangeRequired()
      ) {
        if (adminCanView("view_vendors")) loadAdminVendors();
        if (adminCanView("view_finance")) loadAdminSubscriptions();
        if (adminCanView("view_riders")) loadAdminRiders();
        if (adminCanView("view_team")) loadAdminTeam();
      }

    },
    ADMIN_SLOW_REFRESH_MS
  );


  /* =======================================================
     SUPPORT TICKETS
  ======================================================= */

  const TICKET_CATEGORY_LABELS = {
    delayed_delivery: "Delayed Delivery",
    rider_issue: "Rider Issue",
    package_damaged: "Package Damaged",
    package_missing: "Package Missing",
    incorrect_units_charge: "Incorrect Units/Charge",
    payment_issue: "Payment Issue",
    subscription_issue: "Subscription Issue",
    other: "Other",
  };

  let adminTickets = [];

  async function loadAdminTickets() {
    const tableBody = document.getElementById("adminTicketsBody");
    if (!tableBody) return;

    const search = document.getElementById("ticketsSearchInput")?.value.trim() || "";
    const status = document.getElementById("ticketsStatusFilter")?.value || "";
    const category = document.getElementById("ticketsCategoryFilter")?.value || "";

    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (category) params.set("category", category);

    try {
      const data = await api(`/api/admin/tickets?${params.toString()}`);
      adminTickets = data.tickets || [];

      if (!adminTickets.length) {
        tableBody.innerHTML = '<tr><td colspan="8" class="empty-state">No support tickets found.</td></tr>';
        return;
      }

      tableBody.innerHTML = adminTickets.map(ticket => `
        <tr>
          <td><strong>${ticket.id}</strong></td>
          <td>${ticket.vendorName || ticket.vendorEmail || "—"}</td>
          <td>${TICKET_CATEGORY_LABELS[ticket.category] || ticket.category}</td>
          <td><span class="ticket-priority-badge ${ticket.priority}">${ticket.priority}</span></td>
          <td><span class="ticket-status-badge ${ticket.status}">${(ticket.status || "").replace(/_/g, " ")}</span></td>
          <td>${ticket.assignedTo || "Unassigned"}</td>
          <td>${ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleDateString("en-GB") : "—"}</td>
          <td><button type="button" class="btn outline open-ticket-btn" data-ticket-id="${ticket.id}">View</button></td>
        </tr>
      `).join("");

      tableBody.querySelectorAll(".open-ticket-btn").forEach(button => {
        button.addEventListener("click", () => {
          const ticket = adminTickets.find(t => t.id === button.dataset.ticketId);
          if (ticket) openTicketDetails(ticket);
        });
      });

    } catch (error) {
      tableBody.innerHTML = `<tr><td colspan="8" class="empty-state">${error.message}</td></tr>`;
    }
  }

  document.getElementById("ticketsSearchInput")?.addEventListener("input", () => {
    clearTimeout(window.__ticketSearchDebounce);
    window.__ticketSearchDebounce = setTimeout(loadAdminTickets, 350);
  });
  document.getElementById("ticketsStatusFilter")?.addEventListener("change", loadAdminTickets);
  document.getElementById("ticketsCategoryFilter")?.addEventListener("change", loadAdminTickets);

  const ticketDetailsModal = document.getElementById("ticketDetailsModal");
  const ticketDetailsBody = document.getElementById("ticketDetailsBody");
  const ticketDetailsTitle = document.getElementById("ticketDetailsTitle");

  function closeTicketDetails() {
    ticketDetailsModal?.classList.remove("show");
    ticketDetailsModal?.setAttribute("aria-hidden", "true");
  }
  document.getElementById("closeTicketDetails")?.addEventListener("click", closeTicketDetails);
  document.getElementById("ticketDetailsBackdrop")?.addEventListener("click", closeTicketDetails);

  function openTicketDetails(ticket) {
    if (!ticketDetailsModal || !ticketDetailsBody) return;
    ticketDetailsTitle.textContent = `${ticket.id} — ${TICKET_CATEGORY_LABELS[ticket.category] || ticket.category}`;

    const replies = (ticket.replies || []).map(reply => `
      <div class="ticket-message ${reply.from === "admin" ? "admin-reply" : "vendor-reply"}">
        <div class="message-meta">${reply.from === "admin" ? (reply.authorEmail || "Admin") : "Vendor"} · ${reply.at ? new Date(reply.at).toLocaleString("en-GB") : ""}</div>
        <div>${reply.message}</div>
      </div>
    `).join("");

    const internalNotes = (ticket.internalNotes || []).map(note => `
      <div class="ticket-message internal-note">
        <div class="message-meta">Internal note · ${note.authorEmail || "Admin"} · ${note.at ? new Date(note.at).toLocaleString("en-GB") : ""}</div>
        <div>${note.note}</div>
      </div>
    `).join("");

    ticketDetailsBody.innerHTML = `
      <div class="vendor-detail-grid">
        <div class="vendor-detail-item"><span>Vendor</span><strong>${ticket.vendorName || ticket.vendorEmail}</strong></div>
        <div class="vendor-detail-item"><span>Related Order</span><strong>${ticket.orderId ? `#${ticket.orderId}` : "—"}</strong></div>
        <div class="vendor-detail-item"><span>Created</span><strong>${ticket.createdAt ? new Date(ticket.createdAt).toLocaleString("en-GB") : "—"}</strong></div>
        <div class="vendor-detail-item"><span>Updated</span><strong>${ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString("en-GB") : "—"}</strong></div>
      </div>

      <div class="vendor-detail-section">
        <h3>Description</h3>
        <p>${ticket.description || "—"}</p>
      </div>

      <div class="vendor-detail-section">
        <h3>Manage Ticket</h3>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
          <select id="ticketStatusSelect">
            ${["open", "in_progress", "resolved", "closed"].map(s => `<option value="${s}" ${ticket.status === s ? "selected" : ""}>${s.replace(/_/g, " ")}</option>`).join("")}
          </select>
          <button type="button" class="btn outline" id="applyTicketStatusBtn" data-ticket-id="${ticket.id}">Update Status</button>
          <input type="text" id="ticketAssigneeInput" placeholder="Assign to (admin email)" value="${ticket.assignedTo || ""}">
          <button type="button" class="btn outline" id="applyTicketAssignBtn" data-ticket-id="${ticket.id}">Assign</button>
        </div>
      </div>

      <div class="vendor-detail-section">
        <h3>Conversation (visible to vendor)</h3>
        ${replies || '<p class="empty-state">No replies yet.</p>'}
        <div style="display:flex;gap:8px;margin-block-start:10px">
          <input type="text" id="ticketReplyInput" placeholder="Write a reply the vendor will see..." style="flex:1">
          <button type="button" class="btn primary" id="sendTicketReplyBtn" data-ticket-id="${ticket.id}">Send</button>
        </div>
      </div>

      <div class="vendor-detail-section">
        <h3>Internal Notes (never shown to vendor)</h3>
        ${internalNotes || '<p class="empty-state">No internal notes yet.</p>'}
        <div style="display:flex;gap:8px;margin-block-start:10px">
          <input type="text" id="ticketNoteInput" placeholder="Add an internal note..." style="flex:1">
          <button type="button" class="btn outline" id="addTicketNoteBtn" data-ticket-id="${ticket.id}">Add Note</button>
        </div>
      </div>
    `;

    document.getElementById("applyTicketStatusBtn")?.addEventListener("click", async event => {
      try {
        await teamRequest("/api/admin/tickets/status", {
          ticketId: event.currentTarget.dataset.ticketId,
          status: document.getElementById("ticketStatusSelect").value
        });
        showAdminToast("Ticket status updated.");
        closeTicketDetails();
        loadAdminTickets();
      } catch (error) {
        showAdminToast(error.message, "error");
      }
    });

    document.getElementById("applyTicketAssignBtn")?.addEventListener("click", async event => {
      try {
        await teamRequest("/api/admin/tickets/assign", {
          ticketId: event.currentTarget.dataset.ticketId,
          assigneeEmail: document.getElementById("ticketAssigneeInput").value.trim()
        });
        showAdminToast("Ticket assigned.");
        closeTicketDetails();
        loadAdminTickets();
      } catch (error) {
        showAdminToast(error.message, "error");
      }
    });

    document.getElementById("sendTicketReplyBtn")?.addEventListener("click", async event => {
      const message = document.getElementById("ticketReplyInput").value.trim();
      if (!message) return;
      try {
        const data = await teamRequest("/api/admin/tickets/respond", {
          ticketId: event.currentTarget.dataset.ticketId,
          message
        });
        showAdminToast("Reply sent to vendor.");
        openTicketDetails(data.ticket);
      } catch (error) {
        showAdminToast(error.message, "error");
      }
    });

    document.getElementById("addTicketNoteBtn")?.addEventListener("click", async event => {
      const note = document.getElementById("ticketNoteInput").value.trim();
      if (!note) return;
      try {
        const data = await teamRequest("/api/admin/tickets/note", {
          ticketId: event.currentTarget.dataset.ticketId,
          note
        });
        showAdminToast("Internal note added.");
        openTicketDetails(data.ticket);
      } catch (error) {
        showAdminToast(error.message, "error");
      }
    });

    ticketDetailsModal.classList.add("show");
    ticketDetailsModal.setAttribute("aria-hidden", "false");
  }

  /* =======================================================
     AUDIT LOG
  ======================================================= */

  let auditCurrentPage = 1;
  let auditPagination = { page: 1, totalPages: 1 };

  async function loadAdminAuditLog() {
    const tableBody = document.getElementById("adminAuditLogBody");
    if (!tableBody) return;

    const params = new URLSearchParams({ page: String(auditCurrentPage), pageSize: "50" });

    try {
      const data = await api(`/api/admin/audit-log?${params.toString()}`);
      let entries = data.entries || [];
      auditPagination = data.pagination || { page: 1, totalPages: 1 };

      const search = document.getElementById("auditSearchInput")?.value.trim().toLowerCase();
      const dateFrom = document.getElementById("auditDateFrom")?.value;
      const dateTo = document.getElementById("auditDateTo")?.value;

      if (search) {
        entries = entries.filter(entry =>
          JSON.stringify(entry).toLowerCase().includes(search)
        );
      }
      if (dateFrom) entries = entries.filter(entry => entry.at >= dateFrom);
      if (dateTo) entries = entries.filter(entry => entry.at <= `${dateTo}T23:59:59`);

      const paginationInfo = document.getElementById("auditPaginationInfo");
      if (paginationInfo) paginationInfo.textContent = `Page ${auditPagination.page} of ${auditPagination.totalPages}`;
      document.getElementById("auditPrevPage").disabled = auditPagination.page <= 1;
      document.getElementById("auditNextPage").disabled = auditPagination.page >= auditPagination.totalPages;

      if (!entries.length) {
        tableBody.innerHTML = '<tr><td colspan="6" class="empty-state">No audit log entries found.</td></tr>';
        return;
      }

      tableBody.innerHTML = entries.map(entry => `
        <tr>
          <td>${entry.at ? new Date(entry.at).toLocaleString("en-GB") : "—"}</td>
          <td>${entry.actorEmail || "—"}</td>
          <td>${(entry.action || "").replace(/_/g, " ")}</td>
          <td>${entry.targetType || "—"}${entry.targetId ? ` #${entry.targetId}` : ""}</td>
          <td>${entry.previousValue !== undefined && entry.previousValue !== null ? JSON.stringify(entry.previousValue) : "—"}</td>
          <td>${entry.newValue !== undefined && entry.newValue !== null ? JSON.stringify(entry.newValue) : "—"}</td>
        </tr>
      `).join("");
    } catch (error) {
      tableBody.innerHTML = `<tr><td colspan="6" class="empty-state">${error.message}</td></tr>`;
    }
  }

  document.getElementById("auditSearchInput")?.addEventListener("input", () => {
    clearTimeout(window.__auditSearchDebounce);
    window.__auditSearchDebounce = setTimeout(loadAdminAuditLog, 350);
  });
  document.getElementById("auditDateFrom")?.addEventListener("change", loadAdminAuditLog);
  document.getElementById("auditDateTo")?.addEventListener("change", loadAdminAuditLog);
  document.getElementById("auditPrevPage")?.addEventListener("click", () => {
    if (auditCurrentPage > 1) { auditCurrentPage -= 1; loadAdminAuditLog(); }
  });
  document.getElementById("auditNextPage")?.addEventListener("click", () => {
    if (auditCurrentPage < auditPagination.totalPages) { auditCurrentPage += 1; loadAdminAuditLog(); }
  });

  /* =======================================================
     CSV EXPORTS - triggers a real browser download from the
     existing backend endpoints; no export logic is reimplemented here.
  ======================================================= */

  document.querySelectorAll(".export-btn").forEach(button => {
    button.addEventListener("click", async () => {
      const kind = button.dataset.export;
      button.disabled = true;
      try {
        const response = await fetch(`/api/admin/export/${kind}`, { credentials: "same-origin" });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Export failed.");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${kind}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showAdminToast("Export downloaded.");
      } catch (error) {
        showAdminToast(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  });

  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  applyRoleAwareNavigation();

  if (passwordChangeRequired()) {
    showPasswordGateBanner();
    showAdminView("admin-settings");
    loadAdminSettings();
  } else {
    showAdminView("admin-dashboard");

    loadAdminDashboard();
    loadAdminOrders();
    loadAdminRecentOrders();
    loadAdminSubscriptions();
    loadAdminRiders();
    loadAdminSettings();
    loadAdminTeam();
    loadAdminNotificationSettings();
  }

});

