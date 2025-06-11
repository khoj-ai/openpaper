import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Badge } from './ui/badge';
import Link from 'next/link';
import { OpenAlexMatchResponse, OpenAlexPaper } from '@/lib/schema';

// Extended type for graph nodes
interface GraphNode extends OpenAlexPaper {
    type: 'center' | 'reference' | 'citation';
    group: number;
}


interface CitationGraphProps {
    center: OpenAlexPaper;
    data: OpenAlexMatchResponse;
}

const CitationGraph = ({ data, center }: CitationGraphProps) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const [selectedNode, setSelectedNode] = useState<OpenAlexPaper | null>(null);
    const [dimensions, setDimensions] = useState({ width: 900, height: 450 });

    useEffect(() => {
        // --- Responsive Dimensions ---
        const handleResize = () => {
            if (svgRef.current?.parentElement) {
                setDimensions({
                    width: svgRef.current.parentElement.clientWidth,
                    height: 450
                });
            }
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (!svgRef.current || !data) return;

        // --- Clear SVG for redraw ---
        d3.select(svgRef.current).selectAll('*').remove();

        const { width, height } = dimensions;
        const svg = d3.select(svgRef.current);

        // --- Data Preparation ---
        const citesResults = data.cites?.results || [];
        const citedByResults = data.cited_by?.results || [];

        // Nodes: 'reference' = papers cited by center, 'citation' = papers citing center
        const nodes: GraphNode[] = [
            { ...center, type: 'center' as const, group: 0 },
            ...citesResults.map(paper => ({ ...paper, type: 'reference' as const, group: 1 })),
            ...citedByResults.map(paper => ({ ...paper, type: 'citation' as const, group: 2 }))
        ];

        // Links: Arrows point from the source to the target
        const links = [
            // Center paper -> References
            ...citesResults.map(paper => ({
                source: center.id,
                target: paper.id,
                type: 'references'
            })),
            // Citations -> Center paper
            ...citedByResults.map(paper => ({
                source: paper.id,
                target: center.id,
                type: 'cites'
            }))
        ];

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

        // --- Color Scale ---
        const color = d3.scaleOrdinal<string>()
            .domain(['0', '1', '2'])
            .range(['#1e40af', '#3b82f6', '#60a5fa']); // Dark blue, medium blue, light blue

        // --- D3 Force Simulation ---
        const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
            .force('link', d3.forceLink(links).id(d => (d as any).id).distance(150))
            .force('charge', d3.forceManyBody().strength(-350))
            .force('collision', d3.forceCollide().radius(d => (d as any).type === 'center' ? 35 : 25))
            // KEY CHANGE: This force pulls nodes to a specific X-coordinate based on their type.
            .force('x', d3.forceX<any>(d => {
                if (d.type === 'citation') return width * 0.25; // "Cited by" on the left
                if (d.type === 'reference') return width * 0.75; // "Cites" on the right
                return width / 2; // Center node in the middle
            }).strength(0.4)) // Use a moderate strength to enforce columns
            .force('y', d3.forceY(height / 2).strength(0.05)); // A weak pull to the vertical center

        // --- SVG Elements ---
        const g = svg.append('g');

        // Zoom Behavior
        const zoom = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.3, 3])
            .on('zoom', (event) => {
                g.attr('transform', event.transform);
            });
        svg.call(zoom);

        // Arrowhead markers
        const defs = svg.append('defs');
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

        // Links (lines with arrows)
        const link = g.append('g')
            .selectAll('line')
            .data(links)
            .enter().append('line')
            .attr('stroke', d => d.type === 'references' ? '#60a5fa' : '#3b82f6')
            .attr('stroke-opacity', 0.7)
            .attr('stroke-width', 2)
            .attr('marker-end', d => `url(#arrow-${d.type})`);

        // Nodes (circles with labels)
        const node = g.append('g')
            .selectAll('g')
            .data(nodes)
            .enter().append('g')
            .attr('class', 'node')
            .style('cursor', 'pointer')
            .call(d3.drag<any, any>()
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended));

        node.append('circle')
            .attr('r', d => d.type === 'center' ? 25 : 18)
            .attr('fill', d => color(d.group?.toString() ?? '') || '#cccccc')
            .attr('stroke', '#fff')
            .attr('stroke-width', 3)
            .on('click', (event, d) => {
                setSelectedNode(d);
            })
            .on('mouseover', function (event, d) {
                d3.select(this)
                    .transition()
                    .duration(200)
                    .attr('r', d.type === 'center' ? 30 : 22);
                link.attr('stroke-opacity', l => {
                    const sourceId = (l.source as any).id;
                    const targetId = (l.target as any).id;
                    const nodeId = d.id;
                    return sourceId === nodeId || targetId === nodeId ? 1 : 0.2;
                }).attr('stroke-width', l => {
                    const sourceId = (l.source as any).id;
                    const targetId = (l.target as any).id;
                    const nodeId = d.id;
                    return sourceId === nodeId || targetId === nodeId ? 3 : 1;
                });
            })
            .on('mouseout', function (event, d) {
                d3.select(this)
                    .transition()
                    .duration(200)
                    .attr('r', d.type === 'center' ? 25 : 18);
                link.attr('stroke-opacity', 0.7).attr('stroke-width', 2);
            });

        // Labels (wrapped)
        const labels = node.append('text')
            .attr('text-anchor', 'middle')
            .attr('dy', 45)
            .attr('font-size', '11px')
            .attr('font-weight', '500')
            .attr('fill', '#1f2937')
            .style('pointer-events', 'none');

        labels.each(function (d) {
            const text = d3.select(this);
            const title = d.title || 'No title';
            const words = title.split(/\s+/).reverse();
            let word;
            let line: string[] = [];
            let lineNumber = 0;
            const y = text.attr("y");
            const dy = 0;
            let tspan = text.text(null).append("tspan").attr("x", 0).attr("y", y).attr("dy", dy + "em");
            const lineLimit = 2;
            const charLimit = 25;

            while (word = words.pop()) {
                line.push(word);
                tspan.text(line.join(" "));
                if (tspan.node()!.getComputedTextLength() > charLimit && line.length > 1) {
                    if (lineNumber < lineLimit - 1) {
                        line.pop();
                        tspan.text(line.join(" "));
                        line = [word];
                        tspan = text.append("tspan").attr("x", 0).attr("y", y).attr("dy", (++lineNumber * 1.1) + "em").text(word);
                    } else {
                        line.pop();
                        tspan.text(line.join(" ") + "...");
                        break;
                    }
                }
            }
        });

        // Publication Year
        node.append('text')
            .text(d => d.publication_year || '')
            .attr('text-anchor', 'middle')
            .attr('dy', -35)
            .attr('font-size', '10px')
            .attr('font-weight', '600')
            .attr('fill', '#374151')
            .style('pointer-events', 'none');

        // --- Simulation Tick ---
        simulation.on('tick', () => {
            link
                .attr('x1', d => (d.source as any).x)
                .attr('y1', d => (d.source as any).y)
                .attr('x2', d => (d.target as any).x)
                .attr('y2', d => (d.target as any).y);
            node
                .attr('transform', d => `translate(${(d as any).x},${(d as any).y})`);
        });

        // --- Drag Handlers ---
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

    }, [dimensions, data, center]); // Rerun effect if these change


    return (
        <div className="w-full max-w-7xl mx-auto p-4">
            <div className="border-2 rounded-xl shadow-lg bg-white overflow-hidden">
                <svg
                    ref={svgRef}
                    width={dimensions.width}
                    height={dimensions.height}
                    className="w-full h-full bg-gray-50"
                ></svg>
            </div>

            {selectedNode && (
                <div className="mt-6 p-6 bg-background rounded-xl border-2 shadow-lg">
                    <h3 className="font-bold text-lg text-primary mb-3">
                        {selectedNode.title || 'Untitled Paper'}
                    </h3>

                    {selectedNode.publication_year && (
                        <Badge className="bg-blue-100 text-blue-800 mb-4">
                            {selectedNode.publication_year}
                        </Badge>
                    )}

                    <div className="mb-4 text-sm text-secondary-foreground">
                        <p>
                            <strong>Authors:</strong> {
                                selectedNode.authorships
                                    ?.slice(0, 3)
                                    .map(auth => auth.author?.display_name)
                                    .join(', ') || 'N/A'
                            }
                            {selectedNode.authorships && selectedNode.authorships.length > 3 &&
                                ` et al.`
                            }
                        </p>
                    </div>

                    <div className="flex space-x-3 mt-4">
                        <Link
                            href={`https://doi.org/${selectedNode.doi}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
                        >
                            View Paper
                        </Link>
                    </div>
                </div>
            )}

            <div className="flex justify-center mt-4">
                <div className="bg-background rounded-lg p-3 px-4 border text-primary">
                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs items-center">
                        <div className="flex items-center">
                            <div className="w-4 h-4" style={{ backgroundColor: '#1e40af', borderRadius: '50%', marginRight: '8px' }}></div>
                            <span>Center Paper</span>
                        </div>
                        <div className="flex items-center">
                            <div className="w-3 h-3" style={{ backgroundColor: '#60a5fa', borderRadius: '50%', marginRight: '8px' }}></div>
                            <span>References (Cited by Center)</span>
                        </div>
                        <div className="flex items-center">
                            <div className="w-3 h-3" style={{ backgroundColor: '#3b82f6', borderRadius: '50%', marginRight: '8px' }}></div>
                            <span>Citations (Citing Center)</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CitationGraph;
