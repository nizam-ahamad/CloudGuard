import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

export default function GoogleAnalytics() {
  const location = useLocation();
  const [hasConsent, setHasConsent] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('cloudguard_cookie_consent') === 'accepted';
    } catch {
      return false;
    }
  });
  const [isGtagReady, setIsGtagReady] = useState(false);

  useEffect(() => {
    const handleAccepted = () => setHasConsent(true);
    const handleStorage = (e) => {
      if (e.key === 'cloudguard_cookie_consent') {
        setHasConsent(e.newValue === 'accepted');
      }
    };

    window.addEventListener('cookie_consent_accepted', handleAccepted);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('cookie_consent_accepted', handleAccepted);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!GA_ID || !hasConsent) return;

    if (!window.dataLayer) {
      window.dataLayer = [];
    }
    if (typeof window.gtag !== 'function') {
      window.gtag = function gtag() {
        window.dataLayer.push(arguments);
      };
      window.gtag('js', new Date());
      window.gtag('config', GA_ID, { send_page_view: false });
    }

    if (!document.getElementById('ga4-gtag-script')) {
      const script = document.createElement('script');
      script.id = 'ga4-gtag-script';
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
      document.head.appendChild(script);
    }

    setIsGtagReady(true);
  }, [hasConsent]);

  useEffect(() => {
    if (!GA_ID || !hasConsent || !isGtagReady) return;
    if (typeof window.gtag !== 'function') return;
    if (location.pathname.startsWith('/monitor')) return;

    window.gtag('event', 'page_view', {
      page_path: location.pathname + location.search,
      page_location: window.location.origin + location.pathname + location.search,
      page_title: document.title,
    });
  }, [hasConsent, isGtagReady, location.pathname, location.search]);

  return null;
}
