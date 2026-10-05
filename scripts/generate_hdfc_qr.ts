import QRCode from 'qrcode';
import fs from 'fs';
import sharp from 'sharp';

async function generateHdfcQrCard() {
  const upiUri = 'upi://pay?pa=68283784@hdfcbank&pn=GARG%20RESIDENCY%20PVT%20LTD&mc=6513&tid=68283784&tr=68283784&mode=02';

  // Generate pure QR Code SVG string
  const qrSvg = await QRCode.toString(upiUri, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  });

  const svgInnerMatch = qrSvg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  const qrPaths = svgInnerMatch ? svgInnerMatch[1] : '';

  // Construct complete HDFC Bank SmartHub VYAPAR Standee SVG matching image.png
  const fullCardSvg = `
<svg width="400" height="600" viewBox="0 0 400 600" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="cardClip">
      <rect x="0" y="0" width="400" height="600" rx="20" ry="20" />
    </clipPath>
  </defs>

  <!-- Card Background -->
  <rect x="0" y="0" width="400" height="600" rx="20" ry="20" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1.5" />

  <!-- Top Blue Banner clipped to top rounded corners -->
  <g clip-path="url(#cardClip)">
    <rect x="0" y="0" width="400" height="120" fill="#001449" />
    
    <!-- HDFC Bank Badge -->
    <g transform="translate(130, 26)">
      <rect x="0" y="0" width="76" height="18" rx="2.5" fill="#FFFFFF" />
      <!-- HDFC Logo icon -->
      <rect x="2.5" y="2.5" width="13" height="13" fill="#004c8f" />
      <rect x="4" y="4" width="10" height="10" fill="#FFFFFF" />
      <rect x="7" y="2.5" width="4" height="13" fill="#ED232A" />
      <rect x="2.5" y="7" width="13" height="4" fill="#ED232A" />
      <rect x="6.5" y="6.5" width="5" height="5" fill="#004c8f" />
      <text x="18" y="12.5" font-family="Arial, Helvetica, sans-serif" font-size="7" font-weight="900" fill="#004c8f" letter-spacing="0.3">HDFC BANK</text>
    </g>

    <!-- SmartHub with Red Hub Icon -->
    <g transform="translate(214, 38)">
      <text x="0" y="0" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#FFFFFF">Smart</text>
      <circle cx="56" cy="-5" r="13" fill="#E64121" />
      <text x="44" y="0" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#FFFFFF">Hub</text>
      <!-- Satellite white dots -->
      <circle cx="70" cy="-12" r="2" fill="#FFFFFF" />
      <circle cx="75" cy="-3" r="1.8" fill="#FFFFFF" />
      <circle cx="71" cy="5" r="2" fill="#FFFFFF" />
      <line x1="66" y1="-8" x2="69" y2="-11" stroke="#FFFFFF" stroke-width="1" />
      <line x1="67" y1="-5" x2="73" y2="-3" stroke="#FFFFFF" stroke-width="1" />
      <line x1="66" y1="-2" x2="70" y2="4" stroke="#FFFFFF" stroke-width="1" />
    </g>

    <!-- VYAPAR text -->
    <text x="130" y="76" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="900" fill="#FFFFFF" letter-spacing="3">VYAPAR</text>
  </g>

  <!-- Merchant Name -->
  <text x="200" y="176" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="600" fill="#4B5563" letter-spacing="1">
    GARG RESIDENCY PVT LTD
  </text>

  <!-- Terminal ID (TID) -->
  <text x="200" y="218" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="800" fill="#111827" letter-spacing="0.8">
    TID: 68283784
  </text>

  <!-- Prominent QR Code Area -->
  <g transform="translate(80, 248) scale(6.48)">
    ${qrPaths}
  </g>

  <!-- Footer "Scan & Pay" -->
  <text x="200" y="550" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="500" fill="#525c6a" letter-spacing="0.5">
    Scan &amp; Pay
  </text>
</svg>
`;

  fs.mkdirSync('./public', { recursive: true });
  fs.mkdirSync('./src/assets', { recursive: true });

  fs.writeFileSync('./public/hdfc-vyapar-qr.svg', fullCardSvg);

  // Convert to high-resolution PNG using Sharp
  const pngBuffer = await sharp(Buffer.from(fullCardSvg))
    .png({ quality: 100 })
    .toBuffer();

  fs.writeFileSync('./public/image.png', pngBuffer);
  fs.writeFileSync('./public/hdfc-vyapar-qr.png', pngBuffer);
  fs.writeFileSync('./src/assets/hdfc-vyapar-qr.png', pngBuffer);

  console.log('Successfully generated PNGs with sharp:');
  console.log('- ./public/image.png (' + pngBuffer.length + ' bytes)');
  console.log('- ./public/hdfc-vyapar-qr.png');
  console.log('- ./src/assets/hdfc-vyapar-qr.png');
}

generateHdfcQrCard().catch(console.error);
