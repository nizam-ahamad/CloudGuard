import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const BASE_URL = 'https://cloudguard.site';

const PUBLIC_SEO_MAP = {
  '/': {
    title: 'CloudGuard Vault – Zero-Trust Cloud Storage & AI Malware Detection',
    description:
      'CloudGuard Vault is an encrypted zero-trust cloud storage platform with real-time 3-gate AI malware scanning, instant browser previews, and zero egress fees.',
  },
  '/pricing': {
    title: 'Pricing & Vault Plans – CloudGuard Vault',
    description:
      'Explore CloudGuard Vault plans: start with a 14-day 5 GB free evaluation trial, or upgrade to Essential (50 GB), Pro (100 GB), or Ultra (200 GB) storage.',
  },
  '/login': {
    title: 'Sign In or Create Account – CloudGuard Vault',
    description:
      'Sign in or create your CloudGuard Vault account for zero-trust encrypted cloud storage, 2FA protection, and automated pre-commit AI malware detection.',
  },
  '/register': {
    title: 'Create Account – CloudGuard Vault',
    description:
      'Sign in or create your CloudGuard Vault account for zero-trust encrypted cloud storage, 2FA protection, and automated pre-commit AI malware detection.',
  },
  '/signup': {
    title: 'Sign Up – CloudGuard Vault',
    description:
      'Sign in or create your CloudGuard Vault account for zero-trust encrypted cloud storage, 2FA protection, and automated pre-commit AI malware detection.',
  },
  '/privacy': {
    title: 'Privacy Policy – CloudGuard Vault',
    description:
      'Read the CloudGuard Vault Privacy Policy covering DPDP Act compliance, AES-256 storage encryption, zero-parking retention, and Grievance Officer contacts.',
  },
  '/terms': {
    title: 'Terms of Service – CloudGuard Vault',
    description:
      'Review CloudGuard Vault Terms of Service, including evaluation trial rules, automated security scanning, subscription billing, and account governance.',
  },
  '/refund-policy': {
    title: 'Refund Policy – CloudGuard Vault',
    description:
      'Learn about CloudGuard Vault refund eligibility, 7-day annual plan refund windows, subscription cancellations, and Cashfree payment gateway processing.',
  },
  '/contact': {
    title: 'Contact Support – CloudGuard Vault',
    description:
      'Contact CloudGuard Vault technical support or reach our DPDP Grievance Officer at support@cloudguard.site and privacy@cloudguard.site for assistance.',
  },
};

function upsertMetaTag(attrName, attrValue, content) {
  let el = document.querySelector(`meta[${attrName}="${attrValue}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attrName, attrValue);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

export default function RouteSeo() {
  const location = useLocation();

  useEffect(() => {
    const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';
    const seo = PUBLIC_SEO_MAP[normalizedPath];
    const isPublic = Boolean(seo);

    const title = seo ? seo.title : 'CloudGuard Vault';
    const description = seo
      ? seo.description
      : 'CloudGuard Vault encrypted cloud storage workspace.';
    const canonicalUrl = isPublic
      ? `${BASE_URL}${normalizedPath === '/' ? '/' : normalizedPath}`
      : `${BASE_URL}/`;

    document.title = title;
    upsertMetaTag('name', 'description', description);
    upsertMetaTag('property', 'og:title', title);
    upsertMetaTag('property', 'og:url', canonicalUrl);
    upsertMetaTag('name', 'robots', isPublic ? 'index, follow' : 'noindex, nofollow');

    let canonicalLink = document.querySelector('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute('href', canonicalUrl);
  }, [location.pathname]);

  return null;
}
