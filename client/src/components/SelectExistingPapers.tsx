
'use client';

import { useState, useEffect } from 'react';
import { getAllPapers } from '@/lib/api';
import { PaperItem } from '@/lib/schema';
import { Input } from '@/components/ui/input';

interface SelectExistingPapersProps {
  onPapersSelected: (papers: PaperItem[]) => void;
}

export function SelectExistingPapers({ onPapersSelected }: SelectExistingPapersProps) {
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [filteredPapers, setFilteredPapers] = useState<PaperItem[]>([]);
  const [selectedPapers, setSelectedPapers] = useState<PaperItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    async function fetchPapers() {
      try {
        const allPapers = await getAllPapers();
        setPapers(allPapers.papers);
        setFilteredPapers(allPapers.papers);
      } catch (error) {
        console.error('Error fetching papers:', error);
      }
    }
    fetchPapers();
  }, []);

  useEffect(() => {
    const lowercasedSearchTerm = searchTerm.toLowerCase();
    const filtered = papers.filter((paper) => {
      const titleMatch = paper.title?.toLowerCase().includes(lowercasedSearchTerm);
      const authorMatch = paper.authors?.some((author) =>
        author.toLowerCase().includes(lowercasedSearchTerm)
      );
      const abstractMatch = paper.abstract?.toLowerCase().includes(lowercasedSearchTerm);
      return titleMatch || authorMatch || abstractMatch;
    });
    setFilteredPapers(filtered);
  }, [searchTerm, papers]);

  const handleSelectPaper = (paper: PaperItem) => {
    const isSelected = selectedPapers.some((p) => p.id === paper.id);
    let newSelectedPapers;
    if (isSelected) {
      newSelectedPapers = selectedPapers.filter((p) => p.id !== paper.id);
    } else {
      newSelectedPapers = [...selectedPapers, paper];
    }
    setSelectedPapers(newSelectedPapers);
    onPapersSelected(newSelectedPapers);
  };

  return (
    <div>
      <Input
        placeholder="Search existing papers..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="mb-4"
      />
      <div className="space-y-2">
        {filteredPapers.map((paper) => (
          <div
            key={paper.id}
            onClick={() => handleSelectPaper(paper)}
            className={`p-2 border rounded-lg cursor-pointer ${
              selectedPapers.some((p) => p.id === paper.id) ? 'border-primary' : 'border-border'
            }`}>
            <h3 className="font-semibold">{paper.title}</h3>
            <p className="text-sm text-gray-500">
              {paper.authors?.join(', ')}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
