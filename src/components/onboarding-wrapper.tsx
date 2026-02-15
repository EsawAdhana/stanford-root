'use client';

import { useEffect, useState } from 'react';
import { OnboardingModal } from './onboarding-modal';
import { useAuthStore } from '@/lib/auth-store';
import { useDegreeStore } from '@/stores/degree-store';

/**
 * Wrapper component to handle onboarding modal state
 * Shows modal when user is authenticated but hasn't completed onboarding
 */
export function OnboardingWrapper() {
    const { user, isLoading } = useAuthStore();
    const hasCompletedOnboarding = useDegreeStore(state => state.hasCompletedOnboarding);
    const [showOnboarding, setShowOnboarding] = useState(false);

    useEffect(() => {
        // Only show onboarding if user is authenticated and hasn't completed it
        if (!isLoading && user && !hasCompletedOnboarding) {
            setShowOnboarding(true);
        } else {
            setShowOnboarding(false);
        }
    }, [user, isLoading, hasCompletedOnboarding]);

    return (
        <OnboardingModal
            open={showOnboarding}
            onOpenChange={setShowOnboarding}
        />
    );
}
