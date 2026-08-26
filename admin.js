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

  const PLAN_PRICES = {
    Basic: 67500,
    Growth: 105000,
    Business: 143000
  };

  try {

    const response = await fetch("/api/admin/summary", {
      credentials: "same-origin",
      cache: "no-store"
    });

    if (!response.ok) {
      window.location.replace("/admin-login.html");
      return;
    }

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
     VIEW SWITCHING
  ======================================================= */

  function showAdminView(viewName) {

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

      const monthlyRevenue =
        vendors.reduce(
          (total, vendor) =>
            total + (PLAN_PRICES[vendor.plan] ?? 0),
          0
        );


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

      document.getElementById(
        "subscriptionRevenue"
      ).textContent =
        `₦${monthlyRevenue.toLocaleString("en-NG")}`;


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


      /* =====================================================
        SUMMARY COUNTS
      ===================================================== */

      const totalRiders =
        riders.length;

      const activeRiders =
        riders.filter(
          rider => rider.status === "active"
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
          rider => rider.status === "inactive"
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
            rider.status === "on_delivery"
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
          rider => rider.status === "available"
        );


      if (!riders.length) {

        selects.forEach(select => {
          select.innerHTML = `
            <option value="">
              No available riders
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

  async function loadAdminOrders() {

    const tableBody =
      document.getElementById("adminOrdersBody");

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
          data.error || "Unable to load orders."
        );
      }

      adminOrders = data.orders || [];

      const orders = adminOrders;


      if (!orders.length) {

        tableBody.innerHTML = `
          <tr>
            <td colspan="8" class="empty-state">
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


        const statusLabel =
          order.status === "in-transit"
            ? "In Transit"
            : order.status === "picked-up"
              ? "Picked Up"
              : order.status === "requested"
                ? "Requested"
                : order.status === "assigned"
                  ? "Assigned"
                  : order.status === "delivered"
                    ? "Delivered"
                    : order.status === "failed"
                      ? "Failed"
                      : order.status === "cancelled"
                        ? "Cancelled"
                        : order.status || "—";

        const statusClass =
          order.status === "requested"
            ? "status-requested"
            : order.status === "assigned"
              ? "status-assigned"
              : order.status === "on_delivery"
                ? "status-on-delivery"
                : order.status === "delivered"
                  ? "status-delivered"
                  : order.status === "failed"
                    ? "status-failed"
                    : order.status === "cancelled"
                      ? "status-cancelled"
                      : "";


        const account =
          order.vendorName || "—";


        return `
          <tr>

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


    } catch (error) {

      console.error(
        "ADMIN ORDERS ERROR:",
        error
      );

      tableBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-state">
            Unable to load orders.
          </td>
        </tr>
      `;

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


          const statusLabel =
            order.status === "in-transit"
              ? "In Transit"
              : order.status === "picked-up"
                ? "Picked Up"
                : order.status === "requested"
                  ? "Requested"
                  : order.status === "assigned"
                    ? "Assigned"
                    : order.status === "delivered"
                      ? "Delivered"
                      : order.status === "failed"
                        ? "Failed"
                        : order.status === "cancelled"
                          ? "Cancelled"
                          : order.status || "—";

          const statusClass =
            order.status === "requested"
              ? "status-requested"
              : order.status === "assigned"
                ? "status-assigned"
                : order.status === "on_delivery"
                  ? "status-on-delivery"
                  : order.status === "delivered"
                    ? "status-delivered"
                    : order.status === "failed"
                      ? "status-failed"
                      : order.status === "cancelled"
                        ? "status-cancelled"
                        : "";



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


    const statusLabel =
      order.status === "in-transit"
        ? "In Transit"
        : order.status === "picked-up"
          ? "Picked Up"
          : order.status === "requested"
            ? "Requested"
            : order.status === "assigned"
              ? "Assigned"
              : order.status === "delivered"
                ? "Delivered"
                : order.status === "failed"
                  ? "Failed"
                  : order.status === "cancelled"
                    ? "Cancelled"
                    : order.status || "—";


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
                <div
                  style="
                    margin-block-start: 16px;
                    display: flex;
                    gap: 12px;
                    flex-wrap: wrap;
                    align-items: center;
                  "
                >

                  <button
                    type="button"
                    class="btn primary"
                    id="startDeliveryBtn"
                    data-order-id="${order.id}"
                  >
                    Start Delivery
                  </button>

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
              : order.status === "on_delivery"
                ? `
                  <div
                    style="
                      margin-block-start: 16px;
                      display: flex;
                      gap: 12px;
                      flex-wrap: wrap;
                    "
                  >

                    <button
                      type="button"
                      class="btn primary"
                      id="markDeliveredBtn"
                      data-order-id="${order.id}"
                    >
                      Mark Delivered
                    </button>

                    <button
                      type="button"
                      class="btn outline"
                      id="markFailedBtn"
                      data-order-id="${order.id}"
                    >
                      Mark Failed
                    </button>

                  </div>
                `
                : ""
        }

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


    vendorDetailsModal.classList.add("show");
    vendorDetailsModal.setAttribute("aria-hidden", "false");
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
     INITIAL LOAD
  ======================================================= */

  showAdminView("admin-dashboard");

  loadAdminDashboard();
  loadAdminOrders();
  loadAdminRecentOrders();
  loadAdminSubscriptions();
  loadAdminRiders();
  loadAdminSettings();
  loadAdminNotificationSettings();

});

