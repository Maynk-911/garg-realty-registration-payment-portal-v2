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
import { Project, Registration } from './types.js';

export default function App() {
  const [currentView, setCurrentView] = useState<string>('landing');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('proj_pangot');
  const [activeRegistrationId, setActiveRegistrationId] = useState<string>('');

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
          setSelectedProjectId(data.projects[0].id);
        }
      })
      .catch(err => console.error('Failed to load projects:', err));
  }, []);

  // Handle URL Path matching on initial load (e.g. /payment-status/reg_123 or /admin)
  useEffect(() => {
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
    } else if (path === '/privacy-policy') {
      setCurrentView('policy_privacy');
    } else if (path === '/terms-and-conditions') {
      setCurrentView('policy_terms');
    } else if (path === '/refund-policy') {
      setCurrentView('policy_refund');
    }
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
    setCurrentView('status');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePaymentFailure = (_errorMessage: string) => {
    setIsPaymentModalOpen(false);
    setCurrentView('status');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateTo = (view: string) => {
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
          <LandingPage
            projects={projects}
            onStartRegistration={() => navigateTo('form')}
          />
        )}

        {currentView === 'form' && (
          <RegistrationFlow
            projects={projects}
            selectedProjectId={selectedProjectId}
            onInitiatePayment={handleInitiatePayment}
            onCancel={() => navigateTo('landing')}
          />
        )}

        {currentView === 'status' && (
          <PaymentStatusPage
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
          <PolicyPages type="refund" onBack={() => navigateTo('landing')} />
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
        />
      )}

    </div>
  );
}
