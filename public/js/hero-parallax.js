/**
 * Twinsure Parallax/Hero Section Script
 * (Mouse-move parallax disabled. Dynamic SVG inlining, container wrappers,
 * staggered entry animations, scroll parallax with horizontal drift, and Lenis smooth scrolling enabled.)
 */

document.addEventListener("DOMContentLoaded", () => {
  const layers = document.querySelectorAll(".parallax-layer");
  const wrapper = document.querySelector(".hero-parallax-wrapper");
  
  if (!wrapper || layers.length === 0) return;

  // 1. Initialize Lenis Smooth Scroll to eliminate scroll parallax jitter (jank)
  let lenisInstance = null;
  if (typeof Lenis !== "undefined") {
    lenisInstance = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: "vertical",
      gestureOrientation: "vertical",
      smoothWheel: true,
      smoothTouch: false, // Keep native touch behavior on mobile
    });

    const raf = (time) => {
      lenisInstance.raf(time);
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }

  let inlinedCount = 0;

  // Add loaded class to wrapper to start the transition once all SVGs are inlined
  const checkAllInlined = () => {
    inlinedCount++;
    if (inlinedCount === layers.length) {
      requestAnimationFrame(() => {
        wrapper.classList.add("loaded");
      });
    }
  };

  // Helper to inline SVGs dynamically and wrap them in a container div
  layers.forEach(img => {
    if (img.tagName.toLowerCase() !== "img") {
      checkAllInlined();
      return;
    }
    
    const src = img.getAttribute("src");
    const imgClasses = img.getAttribute("class") || "";
    const imgStyle = img.getAttribute("style");
    const imgAlt = img.getAttribute("alt");
    const imgDataDepth = img.getAttribute("data-depth");
    
    fetch(src)
      .then(response => response.text())
      .then(xmlText => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, "image/svg+xml");
        const svg = doc.querySelector("svg");
        
        if (svg) {
          // Create outer wrapper container
          const container = document.createElement("div");
          // Wrapper gets the layer-specific classes (e.g. layer-man, layer-bg)
          const wrapperClass = `parallax-layer-wrapper ${imgClasses.replace("parallax-layer", "").trim()}`;
          container.setAttribute("class", wrapperClass);
          if (imgDataDepth) container.setAttribute("data-depth", imgDataDepth);
          
          // SVG gets only the base class
          svg.setAttribute("class", "parallax-layer");
          if (imgStyle) svg.setAttribute("style", imgStyle);
          svg.setAttribute("role", "img");
          if (imgAlt) svg.setAttribute("aria-label", imgAlt);
          
          // Assemble
          container.appendChild(svg);
          
          // Replace img in DOM with container wrapper
          img.parentNode.replaceChild(container, img);
        }
        checkAllInlined();
      })
      .catch(err => {
        console.error("Error inlining SVG:", err);
        checkAllInlined();
      });
  });

  // High-performance scroll parallax handler (Applied on the outer wrapper containers)
  let scrollY = window.scrollY;
  let ticking = false;

  const updateScrollParallax = () => {
    const activeWrappers = document.querySelectorAll(".parallax-layer-wrapper");
    activeWrappers.forEach(container => {
      const depth = parseFloat(container.getAttribute("data-depth")) || 0;
      
      // Vertical scroll offset (slower than scroll rate to stay on screen)
      const sy = scrollY * depth * 0.45;
      
      // Horizontal scroll offset (distinct drift directions based on class names)
      let sx = 0;
      if (container.classList.contains("layer-bg")) {
        sx = -scrollY * 0.16; // Cloud drifts left
      } else if (container.classList.contains("layer-shield")) {
        sx = -scrollY * 0.09; // Shield drifts left
      } else if (container.classList.contains("layer-checklist")) {
        sx = scrollY * 0.05;  // Checklist drifts right
      } else if (container.classList.contains("layer-plant")) {
        sx = scrollY * 0.07;  // Plant drifts right
      } else if (container.classList.contains("layer-man")) {
        sx = -scrollY * 0.03; // Man drifts left slightly
      } else if (container.classList.contains("layer-woman")) {
        sx = scrollY * 0.04;  // Woman drifts right slightly
      }
      
      container.style.setProperty("--scroll-y", `${sy}px`);
      container.style.setProperty("--scroll-x", `${sx}px`);
    });
    ticking = false;
  };

  // Listen scroll event
  const scrollListener = () => {
    scrollY = window.scrollY;
    if (!ticking && scrollY <= window.innerHeight) {
      window.requestAnimationFrame(updateScrollParallax);
      ticking = true;
    }
  };

  if (lenisInstance) {
    lenisInstance.on("scroll", scrollListener);
  } else {
    window.addEventListener("scroll", scrollListener, { passive: true });
  }

  // Floating dots carousel demo interaction (purely visual like the image)
  const dots = document.querySelectorAll(".hero-dot");
  if (dots.length > 0) {
    dots.forEach((dot, index) => {
      dot.addEventListener("click", () => {
        dots.forEach(d => d.classList.remove("active"));
        dot.classList.add("active");
      });
    });
  }
});
