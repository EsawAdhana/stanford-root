'use client';

import React, { useState, useEffect } from 'react';
import { useCourseStore } from '@/lib/store';
import { X, ExternalLink, MapPin, Clock, Check, Plus, FileText, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCartStore } from '@/lib/cart-store';
import { Section } from '@/types/course';
import { cn, getSyllabusUrl, parseUnitsOptions, hasVariableUnits } from '@/lib/utils';
import { InstructorList } from './instructor-list';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSyllabusValidity } from '@/hooks/use-syllabus-validity';

interface CourseDetailProps {
  courseId: string;
  onClose: () => void;
  closeOnRemove?: boolean;
}

export function CourseDetail({ courseId, onClose, closeOnRemove }: CourseDetailProps) {
  const { courses } = useCourseStore();
  const { addItem, removeItem, hasItem, getItem } = useCartStore();
  
  // Check if course exists in either store or passed via fallback
  let course = courses.find(c => c.id === courseId);
  const cartItem = getItem(courseId);

  if (!course && cartItem) {
      course = cartItem;
  }

  // Group sections by term
  const sectionsByTerm = (course?.sections || []).reduce((acc, section) => {
    if (!acc[section.term]) acc[section.term] = [];
    acc[section.term].push(section);
    return acc;
  }, {} as Record<string, Section[]>);

  // Sort terms logically
  const terms = Object.keys(sectionsByTerm).sort((a, b) => {
       const order = ['Autumn', 'Winter', 'Spring', 'Summer'];
       const [semA, yearA] = a.split(' ');
       const [semB, yearB] = b.split(' ');
       if (yearA !== yearB) return yearA.localeCompare(yearB);
       return order.indexOf(semA) - order.indexOf(semB);
  });

  // State for active tab
  const [activeTerm, setActiveTerm] = useState<string>(() => {
      if (cartItem?.selectedTerm && terms.includes(cartItem.selectedTerm)) {
          return cartItem.selectedTerm;
      }
      return terms[0] || '';
  });

  // Units: use active section or course; support variable units (e.g. 3-4)
  const unitsSource = (() => {
    const secs = sectionsByTerm[activeTerm]
    const section = secs?.find(s => s.classId === (cartItem?.selectedSectionId ?? secs?.[0]?.classId)) ?? secs?.[0]
    return section?.units ?? course?.units
  })()
  const unitOptions = course ? parseUnitsOptions(unitsSource ?? course.units) : []
  const hasVariable = unitOptions.length > 1
  const [selectedUnits, setSelectedUnits] = useState<number>(() => {
    if (cartItem?.selectedUnits !== undefined && unitOptions.includes(cartItem.selectedUnits)) return cartItem.selectedUnits
    return unitOptions[0] ?? 0
  })
  // Sync selectedUnits when cart item or unit options change
  useEffect(() => {
    if (cartItem?.selectedUnits !== undefined && unitOptions.includes(cartItem.selectedUnits)) {
      setSelectedUnits(cartItem.selectedUnits)
    } else if (unitOptions.length > 0 && !unitOptions.includes(selectedUnits)) {
      setSelectedUnits(unitOptions[0])
    }
  }, [cartItem?.selectedUnits, unitOptions.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  // Get the first section with a valid sectionNumber for the active term to use in syllabus URL
  // Calculate these before the early return so we can use them in hooks
  const activeSections = sectionsByTerm[activeTerm] || []
  const activeSection = activeSections.find(s => s.sectionNumber && s.sectionNumber.trim() !== '') || activeSections[0]
  const syllabusClassId = activeSection?.classId
  const syllabusSectionNumber = activeSection?.sectionNumber

  // Get syllabus URL and validate it - must be called before early return
  const syllabusUrl = course && activeTerm && syllabusSectionNumber
    ? getSyllabusUrl(course.subject, course.code, syllabusClassId, activeTerm, syllabusSectionNumber)
    : null
  const { isValid: isSyllabusValid, isChecking: isCheckingSyllabus } = useSyllabusValidity(syllabusUrl)

  // Update active term if course changes or terms load
  useEffect(() => {
      if (cartItem?.selectedTerm && terms.includes(cartItem.selectedTerm)) {
          setActiveTerm(cartItem.selectedTerm);
      } else if (terms.length > 0 && !terms.includes(activeTerm)) {
          setActiveTerm(terms[0]);
      }
  }, [courseId, cartItem?.selectedTerm, terms.length]); // eslint-disable-line

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!course) return null;

  // Check if this is Spring 2026 (syllabi not available yet)
  const isSpring2026 = activeTerm === 'Spring 2026'

  const isTermInCart = cartItem?.selectedTerm === activeTerm;
  const isDifferentTermInCart = cartItem && cartItem.selectedTerm !== activeTerm;

  const handleToggleCart = () => {
    if (isTermInCart) {
        removeItem(course!.id);
        if (closeOnRemove) {
            onClose();
        }
    } else {
        const defaultSectionId = sectionsByTerm[activeTerm]?.[0]?.classId;
        addItem(course!, activeTerm, defaultSectionId, hasVariable ? selectedUnits : undefined);
    }
  };

  const handleSelectSection = (sectionId: number) => {
      addItem(course!, activeTerm, sectionId, hasVariable ? selectedUnits : undefined);
  };

  const handleUnitsChange = (value: string) => {
    const u = parseInt(value, 10);
    if (!isNaN(u)) {
      setSelectedUnits(u);
      if (isTermInCart) {
        const sectionId = cartItem?.selectedSectionId ?? sectionsByTerm[activeTerm]?.[0]?.classId;
        addItem(course!, activeTerm, sectionId, u);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop (click outside to close) */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-[1px]"
        onMouseDown={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="w-[600px] border-l border-border/40 bg-background/95 backdrop-blur-md h-full shadow-2xl flex flex-col fixed right-0 top-0 bottom-0 overflow-hidden transition-transform duration-300"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/40 shrink-0 bg-background/80 backdrop-blur z-10">
          <div>
              <div className="font-bold text-lg text-destructive tracking-tight">
                  <a 
                      href={`https://oncourse.college/${course.subject.replace(/\s+/g, '')}${course.code.replace(/\s+/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                      title={`Visit OnCourse page for ${course.subject} ${course.code}`}
                  >
                      {course.subject} {course.code}
                  </a>
              </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full hover:bg-secondary">
            <X className="h-5 w-5 opacity-70" />
          </Button>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          <div className="p-8 space-y-8">
            {/* Title & Desc */}
            <div className="space-y-4">
                <h1 className="text-3xl font-extrabold leading-tight text-foreground tracking-tight">{course.title}</h1>
                <div className="flex items-center text-sm text-primary font-semibold opacity-90 gap-3">
                    <span>{course.dept || 'Unknown Dept'}</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                    <span>{course.units} {course.units.toString().trim() === '1' ? 'Unit' : 'Units'}</span>
                </div>
                <p className="text-muted-foreground text-base leading-relaxed font-normal">{course.description}</p>
                
                {/* Syllabus Link */}
                <div className="pt-2 space-y-2">
                    {activeTerm && syllabusSectionNumber ? (
                        <>
                            <div className="text-xs text-muted-foreground flex items-center gap-2">
                                Syllabus for selected term:
                                {!isSpring2026 && isCheckingSyllabus && (
                                    <Loader2 size={12} className="animate-spin opacity-60" />
                                )}
                                {!isSpring2026 && !isCheckingSyllabus && isSyllabusValid === false && (
                                    <div title="Syllabus URL may be invalid">
                                        <AlertCircle size={12} className="text-amber-500" />
                                    </div>
                                )}
                                {!isSpring2026 && !isCheckingSyllabus && isSyllabusValid === null && (
                                    <div title="Unable to verify syllabus availability">
                                        <AlertCircle size={12} className="text-muted-foreground opacity-50" />
                                    </div>
                                )}
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                asChild
                                disabled={isSpring2026}
                                className={cn(
                                    "gap-2 w-full sm:w-auto",
                                    isSpring2026 && "opacity-50 cursor-not-allowed",
                                    !isSpring2026 && isSyllabusValid === false && "border-amber-500/50 text-amber-600 dark:text-amber-400"
                                )}
                            >
                                <a
                                    href={isSpring2026 ? '#' : (syllabusUrl || '#')}
                                    target={isSpring2026 ? undefined : "_blank"}
                                    rel={isSpring2026 ? undefined : "noopener noreferrer"}
                                    onClick={(e) => {
                                        if (isSpring2026 || !syllabusUrl) {
                                            e.preventDefault()
                                        } else {
                                            e.stopPropagation()
                                        }
                                    }}
                                >
                                    <FileText size={16} />
                                    View {activeTerm} Syllabus
                                    {!isSpring2026 && isSyllabusValid === false && (
                                        <span className="text-xs ml-1">(may not be available)</span>
                                    )}
                                    {!isSpring2026 && <ExternalLink size={14} className="opacity-60" />}
                                </a>
                            </Button>
                            {isSpring2026 && (
                                <p className="text-xs text-muted-foreground">
                                    Note: Syllabi for Spring 2026 are not yet available on syllabus.stanford.edu.
                                </p>
                            )}
                            {!isSpring2026 && isSyllabusValid === false && (
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                    This syllabus link may not be available. Try searching on syllabus.stanford.edu directly.
                                </p>
                            )}
                        </>
                    ) : (
                        <div className="text-sm text-muted-foreground">
                            Select a term above to view syllabus
                        </div>
                    )}
                </div>
            </div>

            {/* Sections List via Tabs */}
            <div className="space-y-6">
                {terms.length > 0 ? (
                    <Tabs value={activeTerm} onValueChange={setActiveTerm} className="w-full">
                        <TabsList className="w-full justify-start overflow-x-auto bg-transparent border-b border-border/40 rounded-none h-auto p-0 gap-6">
                            {terms.map(term => (
                                <TabsTrigger 
                                    key={term} 
                                    value={term} 
                                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-0 py-3 font-semibold text-muted-foreground data-[state=active]:text-foreground transition-all"
                                >
                                    {term}
                                </TabsTrigger>
                            ))}
                        </TabsList>

                        {hasVariable && (
                          <div className="mt-4 flex flex-wrap gap-2">
                              {unitOptions.map(u => (
                                <button
                                  key={u}
                                  type="button"
                                  onClick={() => handleUnitsChange(String(u))}
                                  className={cn(
                                    'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                                    selectedUnits === u
                                      ? 'bg-primary text-primary-foreground shadow-sm'
                                      : 'bg-background border border-border hover:bg-muted/80 text-foreground'
                                  )}
                                >
                                  {u} {u === 1 ? 'unit' : 'units'}
                                </button>
                              ))}
                          </div>
                        )}
                        
                        {terms.map(term => (
                            <TabsContent key={term} value={term} className="space-y-6 mt-6 focus-visible:outline-none focus-visible:ring-0">
                                {sectionsByTerm[term].map((section, idx) => (
                                    <div key={idx} className="border border-border/60 rounded-xl p-6 bg-card/50 hover:bg-card hover:shadow-sm transition-all space-y-5">
                                        {/* Section Header */}
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <div className="font-bold text-lg text-foreground flex items-center gap-2">
                                                    {section.component} 
                                                    <span className="text-muted-foreground font-normal text-base">Section {section.sectionNumber}</span>
                                                </div>
                                                <div className="text-xs font-mono text-muted-foreground mt-1">Class ID: {section.classId}</div>
                                            </div>
                                            <div className={cn(
                                                "text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider",
                                                section.status === 'Open' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                                            )}>
                                                {section.status}
                                            </div>
                                        </div>

                                        {/* Key Dates & Times */}
                                        <div className="space-y-3 text-sm text-foreground/80">
                                            <div className="flex items-center gap-3">
                                                <Clock size={16} className="text-muted-foreground shrink-0" />
                                                <span className="font-medium">{new Date(section.startDate).toLocaleDateString()} - {new Date(section.endDate).toLocaleDateString()}</span>
                                            </div>
                                            {section.meetings.map((m, i) => (
                                                <div key={i} className="pl-[28px] border-l-2 border-border/50 ml-2 space-y-1.5 py-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-semibold text-foreground">{m.days}</span>
                                                        <span className="text-muted-foreground">•</span>
                                                        <span>{m.time}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-muted-foreground">
                                                        <MapPin size={14} className="shrink-0" />
                                                        <span className="underline decoration-dotted hover:text-primary transition-colors cursor-pointer">{m.location}</span>
                                                    </div>
                                                    {m.instructors && m.instructors.length > 0 && (
                                                        <div className="flex items-center gap-2 mt-1">
                                                             <InstructorList instructors={m.instructors} limit={3} />
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>

                                        {/* Details Grid */}
                                        <div className="grid grid-cols-2 gap-x-8 gap-y-6 pt-5 border-t border-border/40 text-sm">
                                            <div>
                                                <div className="font-medium text-xs text-muted-foreground mb-1.5 uppercase tracking-wide">
                                                    Grading
                                                </div>
                                                <div className="font-medium">{section.grading}</div>
                                            </div>
                                            <div>
                                                <div className="font-medium text-xs text-muted-foreground mb-1.5 uppercase tracking-wide">
                                                    Units
                                                </div>
                                                {hasVariableUnits(section.units) ? (
                                                  <div className="flex flex-wrap gap-1.5 mt-0.5">
                                                    {unitOptions.map(u => (
                                                      <button
                                                        key={u}
                                                        type="button"
                                                        onClick={() => handleUnitsChange(String(u))}
                                                        className={cn(
                                                          'px-2.5 py-1 rounded text-xs font-medium transition-colors',
                                                          selectedUnits === u
                                                            ? 'bg-primary text-primary-foreground'
                                                            : 'bg-muted hover:bg-muted/80 text-foreground'
                                                        )}
                                                      >
                                                        {u}
                                                      </button>
                                                    ))}
                                                  </div>
                                                ) : (
                                                  <div className="font-medium">{section.units}</div>
                                                )}
                                            </div>
                                            <div>
                                                <div className="font-medium text-xs text-muted-foreground mb-1.5 uppercase tracking-wide">
                                                    Level
                                                </div>
                                                <div className="font-medium">{section.classLevel}</div>
                                            </div>
                                            <div>
                                                <div className="font-medium text-xs text-muted-foreground mb-1.5 uppercase tracking-wide">
                                                    Mode
                                                </div>
                                                <div className="font-medium">{section.instructionalMode}</div>
                                            </div>
                                        </div>

                                        {/* Enrollment Stats */}
                                        <div className="bg-secondary/30 p-4 rounded-lg space-y-3">
                                            <div className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Enrollment</div>
                                            <div className="grid grid-cols-4 gap-4 text-sm text-center">
                                                <div className="flex flex-col">
                                                    <span className="text-emerald-600 dark:text-emerald-400 font-bold text-lg">{section.openSeats}</span>
                                                    <span className="text-[10px] text-muted-foreground uppercase">Open</span>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-lg">{section.enrolled}</span>
                                                    <span className="text-[10px] text-muted-foreground uppercase">Enrolled</span>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-lg">{section.waitlist}</span>
                                                    <span className="text-[10px] text-muted-foreground uppercase">Waitlist</span>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-lg opacity-60">{section.capacity}</span>
                                                    <span className="text-[10px] text-muted-foreground uppercase">Cap</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* GERs */}
                                        {section.gers && section.gers.length > 0 && (
                                            <div className="pt-4 border-t border-border/40 flex gap-2 items-start">
                                                <div className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mt-0.5 shrink-0">
                                                    GERs:
                                                </div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {section.gers.map((ger, i) => (
                                                        <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                                                            {ger}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Select Section Button */}
                                        <div className="pt-4 border-t border-border/40 flex justify-end">
                                            <Button
                                                size="sm"
                                                variant={cartItem?.selectedSectionId === section.classId && cartItem?.selectedTerm === activeTerm ? "default" : "outline"}
                                                className={cn(
                                                    "w-full sm:w-auto",
                                                    cartItem?.selectedSectionId === section.classId && cartItem?.selectedTerm === activeTerm && "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                                                )}
                                                onClick={() => handleSelectSection(section.classId)}
                                            >
                                                {cartItem?.selectedSectionId === section.classId && cartItem?.selectedTerm === activeTerm ? (
                                                    <>
                                                        <Check size={14} className="mr-1.5" />
                                                        Selected
                                                    </>
                                                ) : (
                                                    <>
                                                        <Plus size={14} className="mr-1.5" />
                                                        Select this Section
                                                    </>
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </TabsContent>
                        ))}
                    </Tabs>
                ) : (
                    <div className="text-center text-muted-foreground py-12 bg-secondary/20 rounded-xl border border-dashed border-border/60">
                        No detailed section information available.
                    </div>
                )}
            </div>
        </div>
      </div>

        <div className="p-6 border-t border-border/40 bg-background/95 backdrop-blur shrink-0">
          <Button 
              className="w-full text-base font-semibold h-12 rounded-xl shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]" 
              variant={isTermInCart ? "destructive" : (isDifferentTermInCart ? "secondary" : "default")}
              onClick={handleToggleCart}
              disabled={terms.length === 0}
          >
              {isTermInCart ? "Remove from Schedule" : 
               (isDifferentTermInCart ? `Switch Schedule to ${activeTerm}` : `Add ${activeTerm} to Schedule`)}
          </Button>
        </div>
      </div>
    </div>
  );
}
