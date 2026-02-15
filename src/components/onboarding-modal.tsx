'use client';

import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDegreeStore } from '@/stores/degree-store';
import { getAllMajors, getAllMinors, getTracksForMajor, type Major, type Minor } from '@/lib/major-utils';
import { ChevronRight, ChevronLeft, Search, GraduationCap, BookOpen, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OnboardingModalProps {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
}

export function OnboardingModal({ open, onOpenChange }: OnboardingModalProps) {
    const [step, setStep] = useState(1);
    const [selectedMajor, setSelectedMajor] = useState<string | null>(null);
    const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
    const [coTerm, setCoTerm] = useState(false);
    const [selectedMinor, setSelectedMinor] = useState<string | null>(null);
    const [majorSearch, setMajorSearch] = useState('');
    const [minorSearch, setMinorSearch] = useState('');

    const { actions } = useDegreeStore();

    const majors = useMemo(() => getAllMajors(), []);
    const minors = useMemo(() => getAllMinors(), []);
    const tracks = useMemo(() =>
        selectedMajor ? getTracksForMajor(selectedMajor) : [],
        [selectedMajor]
    );

    const filteredMajors = useMemo(() => {
        if (!majorSearch) return majors;
        return majors.filter(m =>
            m.name.toLowerCase().includes(majorSearch.toLowerCase())
        );
    }, [majors, majorSearch]);

    const filteredMinors = useMemo(() => {
        if (!minorSearch) return minors;
        return minors.filter(m =>
            m.name.toLowerCase().includes(minorSearch.toLowerCase())
        );
    }, [minors, minorSearch]);

    const handleNext = () => {
        // Skip track step if no tracks available
        if (step === 1 && tracks.length === 0) {
            setStep(3);
        } else {
            setStep(step + 1);
        }
    };

    const handleBack = () => {
        // Skip track step if no tracks available
        if (step === 3 && tracks.length === 0) {
            setStep(1);
        } else {
            setStep(step - 1);
        }
    };

    const handleComplete = () => {
        actions.completeOnboarding(selectedMajor, coTerm, selectedMinor, selectedTrack);
        onOpenChange?.(false);
    };

    const handleSkip = () => {
        actions.completeOnboarding(null, false, null, null);
        onOpenChange?.(false);
    };

    const canProceed = () => {
        if (step === 1) return selectedMajor !== null;
        if (step === 2) return selectedTrack !== null;
        return true;
    };

    const totalSteps = tracks.length > 0 ? 4 : 3;
    const currentStep = step === 3 && tracks.length === 0 ? 2 : step;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] h-[80vh] flex flex-col p-0 gap-0 overflow-hidden" hideClose>
                <DialogHeader className="px-6 pt-6 pb-4 border-b">
                    <DialogTitle className="text-2xl font-bold">Welcome to CHANGED</DialogTitle>
                    <p className="text-sm text-muted-foreground mt-2">
                        Let's personalize your course planning experience
                    </p>
                    <div className="flex items-center gap-2 mt-4">
                        {Array.from({ length: totalSteps }).map((_, i) => (
                            <div
                                key={i}
                                className={cn(
                                    "h-1.5 flex-1 rounded-full transition-colors",
                                    i < currentStep ? "bg-primary" : "bg-muted"
                                )}
                            />
                        ))}
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-6 py-6">
                    {step === 1 && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                                    <GraduationCap className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-lg">Select Your Major</h3>
                                    <p className="text-sm text-muted-foreground">
                                        Choose your primary field of study
                                    </p>
                                </div>
                            </div>

                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search majors..."
                                    value={majorSearch}
                                    onChange={(e) => setMajorSearch(e.target.value)}
                                    className="pl-9"
                                />
                            </div>

                            <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
                                {filteredMajors.map((major) => (
                                    <button
                                        key={major.name}
                                        onClick={() => setSelectedMajor(major.name)}
                                        className={cn(
                                            "w-full text-left p-4 rounded-lg border-2 transition-all hover:border-primary/50",
                                            selectedMajor === major.name
                                                ? "border-primary bg-primary/5"
                                                : "border-border"
                                        )}
                                    >
                                        <div className="font-medium">{major.name}</div>
                                        <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                            {major.description}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {step === 2 && tracks.length > 0 && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                                    <BookOpen className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-lg">Choose Your Track</h3>
                                    <p className="text-sm text-muted-foreground">
                                        Select a specialization for {selectedMajor?.split('(')[0].trim()}
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
                                {tracks.map((track) => (
                                    <button
                                        key={track.id}
                                        onClick={() => setSelectedTrack(track.id)}
                                        className={cn(
                                            "w-full text-left p-4 rounded-lg border-2 transition-all hover:border-primary/50",
                                            selectedTrack === track.id
                                                ? "border-primary bg-primary/5"
                                                : "border-border"
                                        )}
                                    >
                                        <div className="font-medium">{track.name}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-6">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                                    <Users className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-lg">Co-term Status</h3>
                                    <p className="text-sm text-muted-foreground">
                                        Are you in a co-terminal master's program?
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <button
                                    onClick={() => setCoTerm(false)}
                                    className={cn(
                                        "w-full text-left p-4 rounded-lg border-2 transition-all hover:border-primary/50",
                                        !coTerm
                                            ? "border-primary bg-primary/5"
                                            : "border-border"
                                    )}
                                >
                                    <div className="font-medium">No, I'm pursuing a bachelor's degree</div>
                                    <div className="text-sm text-muted-foreground mt-1">
                                        Standard undergraduate program
                                    </div>
                                </button>

                                <button
                                    onClick={() => setCoTerm(true)}
                                    className={cn(
                                        "w-full text-left p-4 rounded-lg border-2 transition-all hover:border-primary/50",
                                        coTerm
                                            ? "border-primary bg-primary/5"
                                            : "border-border"
                                    )}
                                >
                                    <div className="font-medium">Yes, I'm in a co-term program</div>
                                    <div className="text-sm text-muted-foreground mt-1">
                                        Pursuing both bachelor's and master's degrees
                                    </div>
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 4 && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                                    <BookOpen className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-lg">Minor (Optional)</h3>
                                    <p className="text-sm text-muted-foreground">
                                        Select a minor if you're pursuing one
                                    </p>
                                </div>
                            </div>

                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search minors..."
                                    value={minorSearch}
                                    onChange={(e) => setMinorSearch(e.target.value)}
                                    className="pl-9"
                                />
                            </div>

                            <button
                                onClick={() => setSelectedMinor(null)}
                                className={cn(
                                    "w-full text-left p-4 rounded-lg border-2 transition-all hover:border-primary/50 mb-2",
                                    selectedMinor === null
                                        ? "border-primary bg-primary/5"
                                        : "border-border"
                                )}
                            >
                                <div className="font-medium">No minor</div>
                            </button>

                            <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar">
                                {filteredMinors.map((minor) => (
                                    <button
                                        key={minor.name}
                                        onClick={() => setSelectedMinor(minor.name)}
                                        className={cn(
                                            "w-full text-left p-4 rounded-lg border-2 transition-all hover:border-primary/50",
                                            selectedMinor === minor.name
                                                ? "border-primary bg-primary/5"
                                                : "border-border"
                                        )}
                                    >
                                        <div className="font-medium">{minor.name}</div>
                                        <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                            {minor.description}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-t flex items-center justify-between bg-muted/30">
                    <div>
                        {step === 1 && (
                            <Button variant="ghost" onClick={handleSkip}>
                                Skip for now
                            </Button>
                        )}
                        {step > 1 && (
                            <Button variant="ghost" onClick={handleBack}>
                                <ChevronLeft className="w-4 h-4 mr-1" />
                                Back
                            </Button>
                        )}
                    </div>

                    <div className="text-sm text-muted-foreground">
                        Step {currentStep} of {totalSteps}
                    </div>

                    <div>
                        {step < totalSteps && (
                            <Button onClick={handleNext} disabled={!canProceed()}>
                                Next
                                <ChevronRight className="w-4 h-4 ml-1" />
                            </Button>
                        )}
                        {step === totalSteps && (
                            <Button onClick={handleComplete}>
                                Complete
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
