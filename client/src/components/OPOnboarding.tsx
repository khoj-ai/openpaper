'use client';

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchFromApi } from "@/lib/api";
import { ShimmerButton } from "./magicui/shimmer-button";
import { useAuth } from "@/lib/auth";

// Airtable-style color palette
const colorPalettes = {
	research: [
		'bg-red-100 text-red-800 border-red-200',
		'bg-orange-100 text-orange-800 border-orange-200',
		'bg-amber-100 text-amber-800 border-amber-200',
		'bg-yellow-100 text-yellow-800 border-yellow-200',
		'bg-lime-100 text-lime-800 border-lime-200',
		'bg-green-100 text-green-800 border-green-200',
		'bg-emerald-100 text-emerald-800 border-emerald-200',
		'bg-teal-100 text-teal-800 border-teal-200',
		'bg-cyan-100 text-cyan-800 border-cyan-200',
		'bg-sky-100 text-sky-800 border-sky-200',
		'bg-blue-100 text-blue-800 border-blue-200',
		'bg-indigo-100 text-indigo-800 border-indigo-200',
		'bg-violet-100 text-violet-800 border-violet-200',
		'bg-purple-100 text-purple-800 border-purple-200',
		'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200',
		'bg-pink-100 text-pink-800 border-pink-200',
		'bg-rose-100 text-rose-800 border-rose-200',
		'bg-gray-100 text-gray-800 border-gray-200',
	],
	job: [
		'bg-blue-100 text-blue-800 border-blue-200',
		'bg-green-100 text-green-800 border-green-200',
		'bg-purple-100 text-purple-800 border-purple-200',
		'bg-orange-100 text-orange-800 border-orange-200',
		'bg-teal-100 text-teal-800 border-teal-200',
		'bg-red-100 text-red-800 border-red-200',
		'bg-indigo-100 text-indigo-800 border-indigo-200',
		'bg-pink-100 text-pink-800 border-pink-200',
		'bg-emerald-100 text-emerald-800 border-emerald-200',
		'bg-amber-100 text-amber-800 border-amber-200',
		'bg-cyan-100 text-cyan-800 border-cyan-200',
		'bg-lime-100 text-lime-800 border-lime-200',
		'bg-violet-100 text-violet-800 border-violet-200',
		'bg-sky-100 text-sky-800 border-sky-200',
		'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200',
		'bg-rose-100 text-rose-800 border-rose-200',
		'bg-yellow-100 text-yellow-800 border-yellow-200',
		'bg-gray-100 text-gray-800 border-gray-200',
	],
	referral: [
		'bg-emerald-100 text-emerald-800 border-emerald-200',
		'bg-blue-100 text-blue-800 border-blue-200',
		'bg-purple-100 text-purple-800 border-purple-200',
		'bg-orange-100 text-orange-800 border-orange-200',
		'bg-teal-100 text-teal-800 border-teal-200',
		'bg-pink-100 text-pink-800 border-pink-200',
		'bg-indigo-100 text-indigo-800 border-indigo-200',
		'bg-amber-100 text-amber-800 border-amber-200',
		'bg-gray-100 text-gray-800 border-gray-200',
	]
};

function getColorForIndex(index: number, type: 'research' | 'job' | 'referral'): string {
	const palette = colorPalettes[type];
	return palette[index % palette.length];
}

const researchFields = [
	"AI/ML", "Biological Sciences", "Chemistry", "Civic Research",
	"Civil Engineering", "Computer Science", "Earth Science",
	"Education Research", "Electrical Engineering", "Hardware", "History",
	"Humanities", "Law/Legal Studies", "Literature", "Medical Sciences",
	"Mathematics", "Neuroscience", "Pharmaceutical / Biotech R&D", "Physics",
	"Psychology", "Public Health", "Public Policy",
	"Regulatory Affairs / Compliance", "Social Sciences", "Other"
].map((field, index) => ({
	value: field.toLowerCase(),
	label: field,
	color: getColorForIndex(index, 'research')
}));

const jobTitles = [
	"Academic - Lecturer", "Academic - Postdoc", "Academic - Professor / Faculty",
	"Academic - Researcher", "Academic - Research Assistant", "Health - Clinician",
	"Health - Public Health", "Health - Research Team Lead", "Industry - Consultant",
	"Industry - Data Scientist", "Industry - Expert Witness", "Industry - Founder",
	"Industry - Research Engineer / Scientist", "Industry - Tech Lead", "Industry - Writer",
	"Legal - Compliance Officer", "Legal - Lawyer", "Legal - Paralegal",
	"Legal - Policy Analyst", "Student - High School", "Student - Master's",
	"Student - PhD", "Student - Undergrad", "Other"
].map((title, index) => ({
	value: title.toLowerCase(),
	label: title,
	color: getColorForIndex(index, 'job')
}));

const referralSourceOptions = [
	"Recommendation from Friend / Colleague", "Search Engine (Google, Bing)",
	"Social Media (LinkedIn, Twitter)", "Social Media (TikTok)", "Blog Post or Article",
	"Conference / Webinar / Workshop", "University / Institution Resource",
	"AI Recommendation (Copilot, ChatGPT)", "Other"
].map((option, index) => ({
	value: option,
	label: option,
	color: getColorForIndex(index, 'referral')
}));



const readingFrequencyOptions = ["0", "1-5 papers", "6-10 papers", "11-20 papers", "21+ papers"];

const formSchema = z.object({
	name: z.string().min(2, {
		message: "Name must be at least 2 characters.",
	}),
	email: z.email({
		message: "Please enter a valid email address.",
	}),
	company: z.string().optional(),
	researchFields: z.array(z.string()).min(1),
	researchFieldsOther: z.string().optional(),
	jobTitles: z.array(z.string()).min(1),
	jobTitlesOther: z.string().optional(),
	readingFrequency: z.string(),
	referralSource: z.string().min(1),
	referralSourceOther: z.string().optional(),
});

export function OPOnboarding() {
	const router = useRouter();
	const [isLoading, setIsLoading] = React.useState(false);
	const { user } = useAuth();

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			name: user?.name,
			email: "",
			company: "",
			researchFields: [],
			researchFieldsOther: "",
			jobTitles: [],
			jobTitlesOther: "",
			readingFrequency: "",
			referralSource: "",
			referralSourceOther: "",
		},
	});

	const researchFieldsValues = form.watch("researchFields");
	const jobTitlesValues = form.watch("jobTitles");
	const referralSourceValue = form.watch("referralSource");

	async function onSubmit(values: z.infer<typeof formSchema>) {
		setIsLoading(true);
		try {
			const payload = {
				name: values.name,
				email: values.email,
				company: values.company,
				research_fields: values.researchFields?.join(", "),
				research_fields_other: values.researchFieldsOther,
				job_titles: values.jobTitles?.join(", "),
				job_titles_other: values.jobTitlesOther,
				reading_frequency: values.readingFrequency,
				referral_source: values.referralSource,
				referral_source_other: values.referralSourceOther,
			};

			await fetchFromApi("/api/onboarding", {
				method: "POST",
				body: JSON.stringify(payload),
			});

			toast.success("Profile complete! Welcome to Open Paper.");
			router.push("/");

		} catch (error) {
			if (error instanceof Error) {
				toast.error(error.message);
			} else {
				toast.error("An unknown error occurred.");
			}
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
				<FormField
					control={form.control}
					name="name"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Name</FormLabel>
							<FormControl>
								<Input placeholder="Richard Feynman" {...field} />
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="email"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Work or University Email</FormLabel>
							<FormControl>
								<Input placeholder="feynman@mit.edu" {...field} />
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="company"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Company or Institution</FormLabel>
							<FormControl>
								<Input placeholder="Los Alamos National Laboratory" {...field} />
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="researchFields"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Primary field of research</FormLabel>
							<FormDescription>
								Which of the following best describes your main area of research? You can select multiple.
							</FormDescription>
							<Popover>
								<PopoverTrigger asChild>
									<FormControl>
										<Button
											variant="outline"
											role="combobox"
											className={cn(
												"w-full justify-between min-h-10 h-auto py-2",
												!field.value?.length && "text-muted-foreground"
											)}
										>
											<div className="flex gap-1 flex-wrap flex-1 text-left">
												{field.value && field.value.length > 0 ? (
													field.value.map((val) => {
														const option = researchFields.find(f => f.value === val);
														return (
															<Badge
																variant="secondary"
																key={val}
																className={cn(
																	"mr-1 mb-1 border",
																	option?.color
																)}
																onClick={(e) => {
																	e.preventDefault();
																	const newValues = field.value?.filter((v) => v !== val);
																	field.onChange(newValues);
																}}
															>
																{option?.label}
																<span className="ml-1 ring-offset-background rounded-full outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
																	<X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
																</span>
															</Badge>
														);
													})
												) : (
													"Select your fields"
												)}
											</div>
											<ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 self-start mt-1" />
										</Button>
									</FormControl>
								</PopoverTrigger>
								<PopoverContent className="w-full p-0">
									<Command>
										<CommandInput placeholder="Search fields..." />
										<CommandList>
											<CommandEmpty>No results found.</CommandEmpty>
											<CommandGroup>
												{researchFields.map((option) => (
													<CommandItem
														key={option.value}
														onSelect={() => {
															const currentValues = field.value || [];
															const newValue = currentValues.includes(option.value)
																? currentValues.filter((v) => v !== option.value)
																: [...currentValues, option.value];
															field.onChange(newValue);
														}}
														className="flex items-center"
													>
														<Check
															className={cn(
																"mr-2 h-4 w-4",
																field.value?.includes(option.value)
																	? "opacity-100"
																	: "opacity-0"
															)}
														/>
														<div className={cn(
															"w-3 h-3 rounded-full mr-2 border",
															option.color
														)} />
														{option.label}
													</CommandItem>
												))}
											</CommandGroup>
										</CommandList>
									</Command>
								</PopoverContent>
							</Popover>
							<FormMessage />
						</FormItem>
					)}
				/>
				{researchFieldsValues?.includes("other") && (
					<FormField
						control={form.control}
						name="researchFieldsOther"
						render={({ field }) => (
							<FormItem>
								<FormLabel>If other, please specify</FormLabel>
								<FormControl>
									<Input placeholder="Your field of research" {...field} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				)}
				<FormField
					control={form.control}
					name="jobTitles"
					render={({ field }) => (
						<FormItem>
							<FormLabel>What is your job title?</FormLabel>
							<FormDescription>
								Which of the following best describes your job title? You can select multiple.
							</FormDescription>
							<Popover>
								<PopoverTrigger asChild>
									<FormControl>
										<Button
											variant="outline"
											role="combobox"
											className={cn(
												"w-full justify-between min-h-10 h-auto py-2",
												!field.value?.length && "text-muted-foreground"
											)}
										>
											<div className="flex gap-1 flex-wrap flex-1 text-left">
												{field.value && field.value.length > 0 ? (
													field.value.map((val) => {
														const option = jobTitles.find(f => f.value === val);
														return (
															<Badge
																variant="secondary"
																key={val}
																className={cn(
																	"mr-1 mb-1 border",
																	option?.color
																)}
																onClick={(e) => {
																	e.preventDefault();
																	const newValues = field.value?.filter((v) => v !== val);
																	field.onChange(newValues);
																}}
															>
																{option?.label}
																<span className="ml-1 ring-offset-background rounded-full outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
																	<X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
																</span>
															</Badge>
														);
													})
												) : (
													"Select your job title(s)"
												)}
											</div>
											<ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 self-start mt-1" />
										</Button>
									</FormControl>
								</PopoverTrigger>
								<PopoverContent className="w-full p-0">
									<Command>
										<CommandInput placeholder="Search job titles..." />
										<CommandList>
											<CommandEmpty>No results found.</CommandEmpty>
											<CommandGroup>
												{jobTitles.map((option) => (
													<CommandItem
														key={option.value}
														onSelect={() => {
															const currentValues = field.value || [];
															const newValue = currentValues.includes(option.value)
																? currentValues.filter((v) => v !== option.value)
																: [...currentValues, option.value];
															field.onChange(newValue);
														}}
														className="flex items-center"
													>
														<Check
															className={cn(
																"mr-2 h-4 w-4",
																field.value?.includes(option.value)
																	? "opacity-100"
																	: "opacity-0"
															)}
														/>
														<div className={cn(
															"w-3 h-3 rounded-full mr-2 border",
															option.color
														)} />
														{option.label}
													</CommandItem>
												))}
											</CommandGroup>
										</CommandList>
									</Command>
								</PopoverContent>
							</Popover>
							<FormMessage />
						</FormItem>
					)}
				/>
				{jobTitlesValues?.includes("other") && (
					<FormField
						control={form.control}
						name="jobTitlesOther"
						render={({ field }) => (
							<FormItem>
								<FormLabel>If other, please specify</FormLabel>
								<FormControl>
									<Input placeholder="Your job title" {...field} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				)}
				<FormField
					control={form.control}
					name="readingFrequency"
					render={({ field }) => (
						<FormItem className="space-y-3">
							<FormLabel>How many papers do you read in a typical week?</FormLabel>
							<FormControl>
								<RadioGroup
									onValueChange={field.onChange}
									defaultValue={field.value}
									className="flex flex-col space-y-1"
								>
									{readingFrequencyOptions.map((option) => (
										<FormItem key={option} className="flex items-center space-x-3 space-y-0">
											<FormControl>
												<RadioGroupItem value={option} />
											</FormControl>
											<FormLabel className="font-normal">
												{option}
											</FormLabel>
										</FormItem>
									))}
								</RadioGroup>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="referralSource"
					render={({ field }) => (
						<FormItem>
							<FormLabel>How did you hear about Open Paper?</FormLabel>
							<Select onValueChange={field.onChange} defaultValue={field.value}>
								<FormControl>
									<SelectTrigger>
										<SelectValue placeholder="Select a source" />
									</SelectTrigger>
								</FormControl>
								<SelectContent>
									{referralSourceOptions.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											<div className="flex items-center">
												<div className={cn(
													"w-3 h-3 rounded-full mr-2 border",
													option.color
												)} />
												{option.label}
											</div>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<FormMessage />
						</FormItem>
					)}
				/>
				{referralSourceValue === "Other" && (
					<FormField
						control={form.control}
						name="referralSourceOther"
						render={({ field }) => (
							<FormItem>
								<FormLabel>If other, please specify</FormLabel>
								<FormControl>
									<Input placeholder="Your source" {...field} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				)}
				<ShimmerButton type="submit" disabled={isLoading} className="text-white dark:text-white float-right py-2">
					{isLoading ? "Booting up..." : "Ready"}
				</ShimmerButton>
			</form>
		</Form>
	);
}
