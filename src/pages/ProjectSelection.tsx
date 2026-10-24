import React from 'react';
import { Project } from '../types.js';
import { PANGOT_ID, DHOLERA_ID } from '../bookingOptions.js';
import { ArrowRight, Handshake, MapPin, ShieldCheck, Sparkles } from 'lucide-react';

interface ProjectSelectionProps {
  projects: Project[];
}

// Homepage: choose a project. Each card links to that project's own page and booking flow.
export const ProjectSelection: React.FC<ProjectSelectionProps> = ({ projects }) => {
  const pangot = projects.find(p => p.id === PANGOT_ID);
  const dholera = projects.find(p => p.id === DHOLERA_ID);

  const cards = [
    {
      id: PANGOT_ID,
      title: 'Pangot – Sukkoon Resort, Nainital',
      location: 'Pangot, Nainital, Uttarakhand',
      blurb: 'Scenic Himalayan hill retreat with co-ownership and full-ownership units.',
      // Genuine photo taken at Pangot. Licence requires the credit shown on the card.
      image: {
        src: '/images/pangot-himalayan-resort.jpg',
        alt: 'Himalayan mountain scenery at Pangot, Nainital',
        position: 'center 30%',
        representative: false,
        credit: 'Photo: raj, CC BY-SA 4.0',
        creditHref: 'https://commons.wikimedia.org/wiki/File:Beauty_of_pangadh.jpg'
      },
      href: '/pangot',
      // Pangot's verified, existing terms
      facts: pangot?.booking_enabled
        ? [`Booking token ₹${(pangot.token_amount || 51000).toLocaleString('en-IN')} per unit`, '15-day refundable token']
        : [],
      open: pangot?.booking_enabled !== false,
      accent: 'from-[#0f5973] to-[#083545]'
    },
    {
      id: DHOLERA_ID,
      title: dholera?.display_name || 'Dholera – Smart City Plots, Gujarat',
      location: dholera?.location || 'Dholera, Gujarat',
      blurb: dholera?.booking_enabled && dholera.tagline ? dholera.tagline : 'Plots in the Dholera smart city region of Gujarat.',
      // No licensed photo of Dholera's own development was available: a representative planned-road image,
      // labelled as such on the card so it is not presented as the project. Licence requires the credit shown.
      image: {
        src: '/images/dholera-smart-city.jpg',
        alt: 'Smart city infrastructure and planned development',
        position: 'center 62%',
        representative: true,
        credit: 'Photo: iMahesh, CC BY-SA 4.0',
        creditHref: 'https://commons.wikimedia.org/wiki/File:Seed_Access_Road_from_Vijayawada_West_Bypass.jpg'
      },
      href: '/dholera',
      // Only figures an admin has published are shown
      facts: dholera?.booking_enabled
        ? [`${(dholera.ownership_plans || []).length} plot option${(dholera.ownership_plans || []).length === 1 ? '' : 's'} available`]
        : [],
      open: Boolean(dholera?.booking_enabled),
      accent: 'from-[#7a4e17] to-[#3d2709]'
    }
  ];

  return (
    <div className="min-h-[calc(100vh-80px)] bg-slate-50">
      <section className="relative overflow-hidden bg-gradient-to-b from-[#0f5973] via-[#0c4c62] to-[#083545] text-white pt-14 pb-28 sm:pt-20 sm:pb-36 px-4 sm:px-6 lg:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:24px_24px] opacity-10 pointer-events-none"></div>
        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-amber-300 text-xs font-semibold mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Garg Realty Group · Official Booking Portal</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight font-['Playfair_Display'] leading-[1.15] mb-4">
            Choose Your Project
          </h1>
          <p className="text-base sm:text-lg text-teal-100/90 max-w-2xl mx-auto leading-relaxed">
            Explore our projects and book your unit securely online.
          </p>
        </div>
      </section>

      <section id="projects" className="relative -mt-20 sm:-mt-24 px-4 sm:px-6 lg:px-8 pb-16">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
          {cards.map(card => {
            return (
              <article key={card.id} className="bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden flex flex-col">
                {/* Header photo (the gradient stays behind it as a fallback if the image cannot load) */}
                <div className={`relative h-36 sm:h-40 bg-gradient-to-br ${card.accent} flex items-end p-5 overflow-hidden`}>
                  <img
                    src={card.image.src}
                    alt={card.image.alt}
                    width={1600}
                    height={1067}
                    decoding="async"
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ objectPosition: card.image.position }}
                    onError={e => { e.currentTarget.style.display = 'none'; }}
                  />
                  {/* Light bottom shade so the status badge and credit stay readable on any part of the photo */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent pointer-events-none"></div>
                  {card.image.representative && (
                    <span className="absolute top-3 left-3 z-10 px-2 py-0.5 rounded-md bg-black/50 text-white text-[10px] font-semibold tracking-wide">
                      Representative image
                    </span>
                  )}
                  <span className={`relative z-10 inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold leading-tight ${
                    card.open
                      ? 'bg-[#10B981] text-white shadow-md shadow-black/20'
                      : 'bg-white text-[#17324D] border border-slate-200 shadow-md shadow-black/20'
                  }`}>
                    {card.open ? 'Bookings Open' : 'Bookings Opening Soon'}
                  </span>
                  <a
                    href={card.image.creditHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute bottom-1.5 right-2.5 z-10 text-[9px] text-white/80 hover:text-white hover:underline"
                  >
                    {card.image.credit}
                  </a>
                </div>
                <div className="p-6 flex-1 flex flex-col">
                  <h2 className="text-xl sm:text-2xl font-extrabold text-[#0f5973] font-['Playfair_Display'] leading-snug">
                    {card.title}
                  </h2>
                  <p className="mt-1.5 text-xs text-slate-500 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#b87e2b]" />
                    <span>{card.location}</span>
                  </p>
                  <p className="mt-4 text-sm text-slate-600 leading-relaxed">{card.blurb}</p>
                  {card.facts.length > 0 && (
                    <ul className="mt-4 space-y-1.5">
                      {card.facts.map(fact => (
                        <li key={fact} className="text-xs text-slate-700 flex items-center gap-2">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                          <span>{fact}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-auto pt-6">
                    <a
                      href={card.href}
                      className="w-full px-6 py-3.5 bg-[#b87e2b] hover:bg-[#a66f24] active:scale-[0.99] text-white text-xs sm:text-sm font-bold uppercase tracking-wider rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <span>Explore &amp; Book</span>
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {/* Channel Partner / Broker onboarding entry point */}
        <div className="max-w-5xl mx-auto mt-8 bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
          <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
            <Handshake className="w-5 h-5 text-[#b87e2b]" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-extrabold text-[#0f5973] font-['Playfair_Display']">Are you a broker or channel partner?</h2>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed">
              Real estate brokers, consultants and channel partner firms can apply to work with Garg Realty Group. Applications are reviewed by our team.
            </p>
          </div>
          <a
            href="/cp-registration"
            className="w-full sm:w-auto px-6 py-3 bg-[#0f5973] hover:bg-[#0c4c62] text-white text-xs font-bold uppercase tracking-wider rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2 shrink-0"
          >
            <span>Become a Channel Partner</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </a>
        </div>
      </section>
    </div>
  );
};
