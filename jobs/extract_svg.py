import fitz  # type: ignore
import xml.etree.ElementTree as ET
import argparse
import os

def extract_figures_from_pdf(pdf_path):
    """
    Extracts graphical elements (figures) from each page of a PDF by converting
    the page to an SVG, preserving image masks, and then removing text elements.

    Args:
        pdf_path (str): The file path to the input PDF.
    """
    output_dir = "output_figures"
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"Created directory: {output_dir}")

    try:
        doc = fitz.open(pdf_path)
        print(f"Processing {len(doc)} pages from '{pdf_path}'...")
    except Exception as e:
        print(f"Error opening PDF: {e}")
        return

    ET.register_namespace('', "http://www.w3.org/2000/svg")
    namespace = '{http://www.w3.org/2000/svg}'

    for page_num in range(len(doc)):
        page = doc[page_num]

        svg_data = page.get_svg_image(text_as_path=False)
        root = ET.fromstring(svg_data)

        # --- Find the definitions section (<defs>) which contains masks ---
        defs_element = root.find(f'{namespace}defs')

        parent_group = root.find(f'{namespace}g')
        if parent_group is None:
            continue

        figure_elements = []
        for elem in parent_group:
            if elem.tag != f'{namespace}text':
                figure_elements.append(elem)

        if not figure_elements:
            print(f"No figures found on page {page_num + 1}.")
            continue

        # Create separate SVG files for each figure element
        for fig_idx, figure_elem in enumerate(figure_elements):
            # Create a new SVG structure, preserving original attributes
            new_svg_root = ET.Element('svg', attrib=root.attrib)

            # --- Add the <defs> section to the new SVG if it exists ---
            if defs_element is not None:
                new_svg_root.append(defs_element)

            # Create a new group and add the single figure element
            new_parent_group = ET.Element('g')
            new_parent_group.append(figure_elem)
            new_svg_root.append(new_parent_group)

            output_filename = f"page_{page_num + 1}_figure_{fig_idx + 1}.svg"
            output_path = os.path.join(output_dir, output_filename)

            tree = ET.ElementTree(new_svg_root)
            try:
                tree.write(output_path, encoding='utf-8', xml_declaration=True)
                print(f"✅ Extracted figure {fig_idx + 1} from page {page_num + 1} to '{output_path}'")
            except Exception as e:
                print(f"❌ Error writing SVG for page {page_num + 1}, figure {fig_idx + 1}: {e}")

        print(f"Total figures extracted from page {page_num + 1}: {len(figure_elements)}")

    doc.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Extracts figures (vector and raster graphics) from a PDF's pages."
    )
    parser.add_argument(
        "pdf_file",
        help="The path to the input PDF file."
    )
    args = parser.parse_args()

    if not os.path.exists(args.pdf_file):
        print(f"Error: File not found at '{args.pdf_file}'")
    else:
        extract_figures_from_pdf(args.pdf_file)
