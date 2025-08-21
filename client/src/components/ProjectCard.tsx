
import Link from "next/link";
import { Project } from "@/lib/schema";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Link href={`/projects/${project.id}`}>
        <Card className="hover:shadow-lg transition-shadow duration-200">
          <CardHeader>
            <CardTitle>{project.title}</CardTitle>
            <CardDescription>{project.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500">
              Created: {new Date(project.created_at).toLocaleDateString()}
            </p>
          </CardContent>
          <CardFooter>
            <p className="text-sm text-gray-500">
              Updated: {new Date(project.updated_at).toLocaleDateString()}
            </p>
          </CardFooter>
        </Card>
    </Link>
  );
}
