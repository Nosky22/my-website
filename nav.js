// Click-to-toggle logic for .nav-dropdown elements.
// Runs on every page that includes this script.
(function () {
  document.querySelectorAll(".nav-dropdown").forEach(function (dropdown) {
    var trigger = dropdown.querySelector(".nav-dropdown-trigger");
    var panel   = dropdown.querySelector(".nav-dropdown-panel");

    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      var isOpen = panel.classList.toggle("open");
      trigger.classList.toggle("open", isOpen);
      trigger.setAttribute("aria-expanded", String(isOpen));
    });

    // Clicks inside the panel (e.g. on links) shouldn't close it prematurely
    panel.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    document.addEventListener("click", function () {
      panel.classList.remove("open");
      trigger.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    });
  });

  // Mobile nav — hamburger open/close
  var navToggle  = document.getElementById("nav-toggle");
  var mobileNav  = document.getElementById("mobile-nav");
  var navClose   = document.getElementById("mobile-nav-close");

  function openMobileNav() {
    mobileNav.classList.add("open");
    mobileNav.setAttribute("aria-hidden", "false");
    navToggle.setAttribute("aria-expanded", "true");
  }

  function closeMobileNav() {
    mobileNav.classList.remove("open");
    mobileNav.setAttribute("aria-hidden", "true");
    navToggle.setAttribute("aria-expanded", "false");
  }

  if (navToggle && mobileNav && navClose) {
    navToggle.addEventListener("click", openMobileNav);
    navClose.addEventListener("click", closeMobileNav);

    // Close on any link click so navigation feels instant
    mobileNav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeMobileNav);
    });
  }
}());
