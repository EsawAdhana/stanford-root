import type { Config } from "tailwindcss";

const config: Config = {
    darkMode: ["class"],
    content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  	extend: {
  		screens: {
  			// Phones wide enough for full-size tab rows (most are 390px or wider);
  			// below this, rows that would overflow shrink. Used as xs: and max-xs:.
  			xs: '380px',
  			// Wide enough for the schedule header's wordmark beside its buttons.
  			'wide-phone': '420px'
  		},
  		fontFamily: {
  			display: ['var(--font-display)', 'ui-serif', 'Georgia', 'serif']
  		},
  		// The calendar's small print, which it used to set inline as text-[11px],
  		// text-[10px] and text-[9px]. T-shirt names keep tailwind-merge treating them
  		// as sizes: a name like text-cal-sm is read as a color and dropped next to one.
  		fontSize: {
  			'2xs': '11px',
  			'3xs': '10px',
  			'4xs': '9px',
  			// The section preview's hour labels on the narrowest phones.
  			'5xs': '8px'
  		},
  		minWidth: {
  			// From sm up, the week grid scrolls sideways below this instead of squeezing.
  			calendar: '700px'
  		},
  		maxWidth: {
  			// The schedule page's header and content widths, for pages that share its layout.
  			shell: '100rem',
  			content: '95rem'
  		},
  		colors: {
  			'cardinal-red': {
  				DEFAULT: '#8C1515',
  				light: '#B83A3A'
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		}
  	}
  },
  plugins: [],
};
export default config;
