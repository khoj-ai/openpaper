import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { OpenAlexMatchResponse, OpenAlexPaper } from '@/lib/schema';

interface CitationGraphProps {
    center: OpenAlexPaper;
    data: OpenAlexMatchResponse;
}

const CitationGraph = ({ data, center }: CitationGraphProps) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const [selectedNode, setSelectedNode] = useState<OpenAlexPaper | null>(null);
    const [dimensions, setDimensions] = useState({ width: 900, height: 600 });

    useEffect(() => {
        const handleResize = () => {
            setDimensions({ width: Math.min(window.innerWidth * 0.9, 1200), height: 600 });
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (!svgRef.current) return;

        // Clear previous content
        d3.select(svgRef.current).selectAll('*').remove();

        const { width, height } = dimensions;
        const svg = d3.select(svgRef.current);

        // Extract results arrays from the response objects
        const citesResults = data.cites?.results || [];
        const citedByResults = data.cited_by?.results || [];

        console.log('Center paper:', center);
        console.log('References (papers this paper cites):', citesResults);
        console.log('Citations (papers that cite this paper):', citedByResults);

        // Create nodes with corrected terminology
        const nodes = [
            { ...center, type: 'center', group: 0 },
            ...citesResults.map(paper => ({ ...paper, type: 'reference', group: 1 })), // Papers this paper references
            ...citedByResults.map(paper => ({ ...paper, type: 'citation', group: 2 })) // Papers that cite this paper
        ];

        // Create links with proper direction
        const links = [
            ...citesResults.map(paper => ({
                source: center.id, // Center paper cites these references
                target: paper.id,
                type: 'references'
            })),
            ...citedByResults.map(paper => ({
                source: paper.id, // These papers cite the center paper
                target: center.id,
                type: 'cites'
            }))
        ];

        console.log('Nodes:', nodes);
        console.log('Links:', links);

        // Early return if no data to display
        if (nodes.length <= 1) {
            svg.append('text')
                .attr('x', width / 2)
                .attr('y', height / 2)
                .attr('text-anchor', 'middle')
                .attr('font-size', '16px')
                .attr('fill', '#666')
                .text('No citation data available');
            return;
        }

        // Improved color scale with neutral blues
        const color = d3.scaleOrdinal()
            .domain(['0', '1', '2'])
            .range(['#1e40af', '#3b82f6', '#60a5fa']); // Dark blue, medium blue, light blue

        // Create force simulation with better spacing
        const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
            .force('link', d3.forceLink(links).id(d => (d as any).id).distance(200))
            .force('charge', d3.forceManyBody().strength(-400))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(80))
            .force('x', d3.forceX(width / 2).strength(0.1))
            .force('y', d3.forceY(height / 2).strength(0.1));

        // Create main group first
        const g = svg.append('g');

        // Create zoom behavior
        const zoom = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.3, 2])
            .on('zoom', (event) => {
                g.attr('transform', event.transform);
            });

        svg.call(zoom);

        // Create arrow markers for directed edges with different colors
        const defs = svg.append('defs');

        // Arrow for references (center -> references)
        defs.append('marker')
            .attr('id', 'arrow-references')
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 25)
            .attr('refY', 0)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', '#60a5fa');

        // Arrow for citations (citations -> center)
        defs.append('marker')
            .attr('id', 'arrow-cites')
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 25)
            .attr('refY', 0)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', '#3b82f6');

        // Create links with different colors
        const link = g.append('g')
            .selectAll('line')
            .data(links)
            .enter().append('line')
            .attr('stroke', d => d.type === 'references' ? '#60a5fa' : '#3b82f6')
            .attr('stroke-opacity', 0.7)
            .attr('stroke-width', 2)
            .attr('marker-end', d => `url(#arrow-${d.type})`);

        // Create nodes
        const node = g.append('g')
            .selectAll('g')
            .data(nodes)
            .enter().append('g')
            .attr('class', 'node')
            .style('cursor', 'pointer')
            .call(d3.drag<SVGGElement, any>()
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended));

        // Add circles to nodes with better sizing
        node.append('circle')
            .attr('r', d => d.type === 'center' ? 25 : 18)
            .attr('fill', d => color(d.group.toString()) as string || '#cccccc')
            .attr('stroke', '#fff')
            .attr('stroke-width', 3)
            .on('click', (event, d) => {
                setSelectedNode(d);
            })
            .on('mouseover', function (event, d) {
                d3.select(this)
                    .transition()
                    .duration(200)
                    .attr('r', d.type === 'center' ? 30 : 22)
                    .attr('stroke-width', 4);

                // Highlight connected links
                link.attr('stroke-opacity', l => {
                    return (l.source as any).id === (d as any).id || (l.target as any).id === (d as any).id ? 1 : 0.2;
                });
            })
            .on('mouseout', function (event, d) {
                d3.select(this)
                    .transition()
                    .duration(200)
                    .attr('r', d.type === 'center' ? 25 : 18)
                    .attr('stroke-width', 3);

                // Reset link opacity
                link.attr('stroke-opacity', 0.7);
            });

        // Add labels with better text handling
        const labels = node.append('text')
            .attr('text-anchor', 'middle')
            .attr('dy', 45)
            .attr('font-size', '11px')
            .attr('font-weight', '500')
            .attr('fill', '#1f2937')
            .style('pointer-events', 'none');

        // Add title text with word wrapping
        labels.each(function (d) {
            const text = d3.select(this);
            const title = d.title || 'No title';
            const maxLength = 40;

            if (title.length <= maxLength) {
                text.text(title);
            } else {
                // Split into two lines
                const words = title.split(' ');
                let line1 = '';
                let line2 = '';

                for (let i = 0; i < words.length; i++) {
                    if (line1.length + words[i].length + 1 <= maxLength / 2) {
                        line1 += (line1 ? ' ' : '') + words[i];
                    } else {
                        line2 += (line2 ? ' ' : '') + words[i];
                    }
                }

                if (line2.length > maxLength / 2) {
                    line2 = line2.substring(0, maxLength / 2 - 3) + '...';
                }

                text.append('tspan')
                    .attr('x', 0)
                    .attr('dy', 0)
                    .text(line1);

                if (line2) {
                    text.append('tspan')
                        .attr('x', 0)
                        .attr('dy', '1.1em')
                        .text(line2);
                }
            }
        });

        // Add publication year with better positioning
        node.append('text')
            .text(d => d.publication_year || '')
            .attr('text-anchor', 'middle')
            .attr('dy', -35)
            .attr('font-size', '10px')
            .attr('font-weight', '600')
            .attr('fill', '#374151')
            .style('pointer-events', 'none');

        // Update positions on simulation tick
        simulation.on('tick', () => {
            link
                .attr('x1', d => (d.source as any).x)
                .attr('y1', d => (d.source as any).y)
                .attr('x2', d => (d.target as any).x)
                .attr('y2', d => (d.target as any).y);

            node
                .attr('transform', d => `translate(${(d as any).x},${(d as any).y})`);
        });

        // Drag functions
        function dragstarted(event: any, d: any) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }

        function dragged(event: any, d: any) {
            d.fx = event.x;
            d.fy = event.y;
        }

        function dragended(event: any, d: any) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }

    }, [dimensions, data, center]);

    const getViewPaperLink = (paper: OpenAlexPaper) => {
        if (paper.doi) {
            return `https://doi.org/${paper.doi}`;
        }
        return paper.id;
    };

    const handlePaperClick = (paper: OpenAlexPaper) => {
        const link = getViewPaperLink(paper);
        window.open(link, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="w-full max-w-7xl mx-auto p-4">

            <div className="border-2 rounded-xl shadow-lg bg-white overflow-hidden">
                <svg
                    ref={svgRef}
                    width={dimensions.width}
                    height={dimensions.height}
                    className="w-full bg-gray-50"
                ></svg>
            </div>

            {/* Improved Selected Node Info */}
            {selectedNode && (
                <div className="mt-6 p-6 bg-background rounded-xl border-2 shadow-lg">
                    <div className="flex justify-between items-start mb-4">
                        <h3 className="font-bold text-xl text-primary flex-1 mr-4">
                            {selectedNode.title || 'Untitled Paper'}
                        </h3>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <p className="text-sm text-primary mb-2">
                                <strong className="text-primary">Authors:</strong> {
                                    selectedNode.authorships
                                        ?.slice(0, 5)
                                        .map(auth => auth.author?.display_name)
                                        .join(', ') || 'N/A'
                                }
                                {selectedNode.authorships && selectedNode.authorships.length > 5 &&
                                    ` (+${selectedNode.authorships.length - 5} more)`
                                }
                            </p>
                        </div>
                        <div>
                            {selectedNode.publication_year && (
                                <p className="text-sm text-primary mb-2">
                                    <strong className="text-primary">Year:</strong> {selectedNode.publication_year}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex space-x-3">
                        <button
                            onClick={() => setSelectedNode(null)}
                            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300 transition-colors"
                        >
                            Close
                        </button>
                        <button
                            onClick={() => handlePaperClick(selectedNode)}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                            View Paper
                        </button>
                    </div>
                </div>
            )}

            {/* Improved Legend */}
            <div className="flex justify-center mt-3">
                <div className="bg-secondary rounded-lg p-4 border">
                    <div className="flex space-x-8 text-sm">
                        <div className="flex items-center">
                            <div className="w-5 h-5 bg-blue-800 rounded-full mr-3"></div>
                            <span className="font-medium">Center Paper</span>
                        </div>
                        <div className="flex items-center">
                            <div className="w-4 h-4 bg-blue-500 rounded-full mr-3"></div>
                            <span>References <span className="text-secondary-foreground">(papers cited by center)</span></span>
                        </div>
                        <div className="flex items-center">
                            <div className="w-4 h-4 bg-blue-300 rounded-full mr-3"></div>
                            <span>Citations <span className="text-secondary-foreground">(papers citing center)</span></span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CitationGraph;
