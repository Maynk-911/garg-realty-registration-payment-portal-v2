/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar.js';
import { Footer } from './components/Footer.js';
import { PaymentModal } from './components/PaymentModal.js';
import { LandingPage } from './pages/LandingPage.js';
import { RegistrationFlow } from './pages/RegistrationFlow.js';
import { PaymentStatusPage } from './pages/PaymentStatusPage.js';
import { TrackBookingPage } from './pages/TrackBookingPage.js';
import { AdminDashboard } from './pages/AdminDashboard.js';
import { PolicyPages } from './pages/PolicyPages.js';
import { ProjectSelection } from './pages/ProjectSelection.js';
import { ProjectDetailsPage } from './pages/ProjectDetailsPage.js';
import { PANGOT_ID, DHOLERA_ID } from './bookingOptions.js';
import { Project, Registration } from './types.js';

export default function App() {
  const [currentView, setCurrentView] = useState<string>('landing');
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeRegistrationId, setActiveRegistrationId] = useState<string>('');
  // Bumped after a payment submission so the status page reloads even when it is already open
  const [statusRefreshKey, setStatusRefreshKey] = useState(0);

  // Payment Modal State
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [activeOrderData, setActiveOrderData] = useState<any>(null);
  const [activeRegistrationData, setActiveRegistrationData] = useState<any>(null);

  // Fetch Projects from Backend
  useEffect(() => {
    fetch('/api/projects')
      .then(res => res.json())
      .then(data => {
        if (data.projects && data.projects.length > 0) {
          setProjects(data.projects);
        }
      })
      .catch(err => console.error('Failed to load projects:', err));
  }, []);

  // Keep the current page in sync with direct links and browser Back/Forward.
  useEffect(() => {
    const syncLocation = () => {
    const path = window.location.pathname;
    if (path.startsWith('/payment-status/')) {
      const regId = path.split('/payment-status/')[1];
      if (regId) {
        setActiveRegistrationId(regId);
        setCurrentView('status');
      }
    } else if (path === '/admin') {
      setCurrentView('admin');
    } else if (path === '/track') {
      setCurrentView('track');
    } else if (path === '/register') {
      setCurrentView('form');
    } else if (path === '/pangot') {
      setCurrentView('pangot');
    } else if (path === '/dholera') {
      setCurrentView('dholera');
    } else if (path === '/dholera/register') {
      setCurrentView('form_dholera');
    } else if (path === '/privacy-policy') {
      setCurrentView('policy_privacy');
    } else if (path === '/terms-and-conditions') {
      setCurrentView('policy_terms');
    } else if (path === '/refund-policy') {
      setCurrentView('policy_refund');
    } else {
      setCurrentView('landing');
    }
    setIsPaymentModalOpen(false);
    };
    syncLocation();
    window.addEventListener('popstate', syncLocation);
    return () => window.removeEventListener('popstate', syncLocation);
  }, []);

  // Handler to initiate payment modal from form or retry
  const handleInitiatePayment = (orderData: any, registrationData: any) => {
    setActiveOrderData(orderData);
    setActiveRegistrationData(registrationData);
    setActiveRegistrationId(registrationData.id);
    setIsPaymentModalOpen(true);
  };

  const handlePaymentSuccess = (_paymentResult: any) => {
    setIsPaymentModalOpen(false);
    setStatusRefreshKey(k => k + 1);
    navigateTo('status');
  };

  const handlePaymentFailure = (_errorMessage: string) => {
    setIsPaymentModalOpen(false);
    navigateTo('status');
  };

  const navigateTo = (view: string) => {
    const paths: Record<string, string> = {
      landing: '/', form: '/register', track: '/track', admin: '/admin',
      pangot: '/pangot', dholera: '/dholera', form_dholera: '/dholera/register',
      policy_terms: '/terms-and-conditions', policy_privacy: '/privacy-policy',
      policy_refund: '/refund-policy', status: `/payment-status/${activeRegistrationId}`
    };
    const path = paths[view];
    if (!path) return;
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path + window.location.search);
    }
    setCurrentView(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans">
      
      {/* Top Navbar */}
      <Navbar 
        currentView={currentView}
        onNavigate={navigateTo}
      />

      {/* Main Content Area */}
      <main className="flex-1">
        {currentView === 'landing' && (
          <ProjectSelection projects={projects} />
        )}

        {/* Pangot: existing project page and booking form (unchanged URLs: /pangot, /register) */}
        {currentView === 'pangot' && (
          <LandingPage
            projects={projects}
            onStartRegistration={() => navigateTo('form')}
          />
        )}

        {currentView === 'form' && (
          <RegistrationFlow
            key={PANGOT_ID}
            projects={projects}
            projectId={PANGOT_ID}
            onInitiatePayment={handleInitiatePayment}
            onCancel={() => navigateTo('pangot')}
          />
        )}

        {/* Dholera: its own project page and booking form */}
        {currentView === 'dholera' && (
          <ProjectDetailsPage
            project={projects.find(p => p.id === DHOLERA_ID)}
            registerHref="/dholera/register"
          />
        )}

        {currentView === 'form_dholera' && (
          <RegistrationFlow
            key={DHOLERA_ID}
            projects={projects}
            projectId={DHOLERA_ID}
            onInitiatePayment={handleInitiatePayment}
            onCancel={() => navigateTo('dholera')}
          />
        )}

        {currentView === 'status' && (
          <PaymentStatusPage
            key={`${activeRegistrationId}-${statusRefreshKey}`}
            registrationId={activeRegistrationId}
            onRetryPayment={handleInitiatePayment}
            onNavigateHome={() => navigateTo('landing')}
          />
        )}

        {currentView === 'track' && (
          <TrackBookingPage
            onNavigateHome={() => navigateTo('landing')}
            onPayNow={handleInitiatePayment}
          />
        )}

        {currentView === 'admin' && (
          <AdminDashboard
            onNavigateHome={() => navigateTo('landing')}
          />
        )}

        {currentView === 'policy_terms' && (
          <PolicyPages type="terms" onBack={() => navigateTo('landing')} />
        )}
        {currentView === 'policy_privacy' && (
          <PolicyPages type="privacy" onBack={() => navigateTo('landing')} />
        )}
        {currentView === 'policy_refund' && (
          <PolicyPages type="refund" onBack={() => navigateTo('landing')} projects={projects} />
        )}
      </main>

      {/* Footer */}
      <Footer onNavigate={navigateTo} />

      {/* Payment Gateway Modal (Razorpay + Test Sandbox) */}
      {isPaymentModalOpen && activeOrderData && activeRegistrationData && (
        <PaymentModal
          isOpen={isPaymentModalOpen}
          onClose={() => setIsPaymentModalOpen(false)}
          orderData={activeOrderData}
          registrationData={activeRegistrationData}
          onSuccess={handlePaymentSuccess}
          onFailure={handlePaymentFailure}
          paymentQrUrl={projects.find(p => p.id === activeRegistrationData.projectId)?.payment_qr_url}
          payeeName={projects.find(p => p.id === activeRegistrationData.projectId)?.payee_name}
        />
      )}

    </div>
  );
}
