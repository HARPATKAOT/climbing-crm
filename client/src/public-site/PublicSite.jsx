import React, { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import PublicLayout from './PublicLayout.jsx';

const Home       = lazy(() => import('./pages/Home.jsx'));
const Activities = lazy(() => import('./pages/Activities.jsx'));
const Classes    = lazy(() => import('./pages/Classes.jsx'));
const Events     = lazy(() => import('./pages/Events.jsx'));
const Calendar   = lazy(() => import('./pages/Calendar.jsx'));
const About      = lazy(() => import('./pages/About.jsx'));
const Boaz       = lazy(() => import('./pages/Boaz.jsx'));
const Gallery    = lazy(() => import('./pages/Gallery.jsx'));
const Faq        = lazy(() => import('./pages/Faq.jsx'));
const Community  = lazy(() => import('./pages/Community.jsx'));
const TripCategory = lazy(() => import('./pages/TripCategory.jsx'));
const TripDetail = lazy(() => import('./pages/TripDetail.jsx'));
const Contact    = lazy(() => import('./pages/Contact.jsx'));

function Loading() {
  return <div style={{ padding: 60, textAlign: 'center', color: '#5A6367' }}>טוען…</div>;
}

/**
 * The public marketing site. Mounted on the bare domain; `app.` serves the CRM.
 * Existing public form routes (/health, /event/:slug, …) are matched earlier in
 * main.jsx and never reach here.
 */
export default function PublicSite() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<Home />} />
          <Route path="activities" element={<Activities />} />
          <Route path="activities/:key/:tripSlug" element={<TripDetail />} />
          <Route path="activities/:key" element={<TripCategory />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="classes" element={<Classes />} />
          <Route path="events" element={<Events />} />
          <Route path="about" element={<About />} />
          <Route path="boaz" element={<Boaz />} />
          <Route path="gallery" element={<Gallery />} />
          <Route path="faq" element={<Faq />} />
          <Route path="community" element={<Community />} />
          <Route path="contact" element={<Contact />} />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
