// Single source of truth for CMS-editable content. Every key here has a
// baked-in default matching what's currently live on the site, so the page
// renders correctly even before the database has been provisioned or a row
// has been edited. The admin dashboard and the public /api/content endpoint
// both read from this same map.

const DEFAULTS = {
  contact_phone: '464-927-6146',
  contact_email: 'info@ecleanproservices.com',
  contact_address: '19980 Aine Drive, Frankfort, IL 60423',
  contact_hours: 'Mon–Sun: 8:00 AM – 8:00 PM',

  hero_eyebrow: 'Commercial, Residential & Facility Maintenance',
  hero_headline: 'Cleaning With Purpose. Service You Can Trust.',
  hero_slogan: 'Clean Today. Protect Tomorrow.',
  hero_lead:
    'E-Clean Pro Services LLC helps Illinois businesses maintain clean, safe, and welcoming facilities — with reliable scheduling, professional standards, and cleaning programs built around your operation.',

  about_heading: 'A Clean Facility Is More Than Appearance',
  about_text_1:
    "We understand that a clean facility contributes to employee productivity, customer confidence, workplace safety, and the overall reputation of an organization. That's why we approach every facility with attention to detail, consistency, and a commitment to delivering results our clients can depend on.",
  about_text_2:
    'Our mission is simple: to provide dependable, high-quality commercial cleaning services while building lasting relationships with the businesses and organizations we serve.',

  // "Who We Serve" card title + description, in fixed display order — one
  // per photo card on the homepage. The photo/icon per card stays fixed in
  // the page's own code; only the title and description text is CMS-editable.
  services_industries: JSON.stringify([
    { name: 'Corporate & Professional Offices', description: 'Custom cleaning programs built around your schedule.' },
    { name: 'Medical & Healthcare Facilities', description: 'Custom cleaning programs built around your schedule.' },
    { name: 'Schools & Educational Institutions', description: 'Custom cleaning programs built around your schedule.' },
    { name: 'Apartment & Commercial Properties', description: 'Custom cleaning programs built around your schedule.' },
    { name: 'Warehouses & Distribution Centers', description: 'Custom cleaning programs built around your schedule.' },
    { name: 'Retail Businesses', description: 'Custom cleaning programs built around your schedule.' },
    { name: 'Churches & Religious Facilities', description: 'Custom cleaning programs built around your schedule.' },
    { name: 'Government & Institutional Facilities', description: 'Custom cleaning programs built around your schedule.' },
  ]),

  pricing_facility_types: JSON.stringify([
    { name: 'Corporate / Professional Office', rate: 0.12 },
    { name: 'Medical / Healthcare Facility', rate: 0.18 },
    { name: 'School / Educational Institution', rate: 0.1 },
    { name: 'Apartment & Commercial Properties', rate: 0.09 },
    { name: 'Warehouse / Distribution Center', rate: 0.06 },
    { name: 'Retail Business', rate: 0.11 },
    { name: 'Church / Religious Facility', rate: 0.08 },
    { name: 'Government / Institutional', rate: 0.13 },
    { name: 'Post-Construction Cleanup', rate: 0.22 },
    { name: 'Airbnb / Short-Term Rental', rate: 0.15 },
    { name: 'Move-In / Move-Out Cleaning', rate: 0.16 },
  ]),

  pricing_addons: JSON.stringify([
    { name: 'Window Cleaning', price: 40 },
    { name: 'Carpet Cleaning', price: 60 },
    { name: 'Floor Strip & Wax', price: 80 },
    { name: 'Disinfection Service', price: 50 },
    { name: 'Restroom Restocking', price: 25 },
  ]),

  // Total floor multiplier = 1 + (floors - 1) * pricing_floor_factor.
  // factor 1 replicates the original "straight multiply by floor count" behavior.
  pricing_floor_factor: '1',
  pricing_minimum_per_visit: '75',

  // Company profile — used on future invoice/report exports, distinct from
  // the public-site Contact Info above.
  company_name: 'E-Clean Pro Services LLC',
  company_logo_url: '',
  company_tax_id: '',
  invoice_footer_note: '',
};

const CONTENT_KEYS = Object.keys(DEFAULTS);

module.exports = { DEFAULTS, CONTENT_KEYS };
